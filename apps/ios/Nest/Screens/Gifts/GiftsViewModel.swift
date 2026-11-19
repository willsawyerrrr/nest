import Foundation
import Observation

/// What the Gifts screen renders once loaded: the rows the signed-in member may
/// see, and who that member is.
struct GiftsContent: Equatable, Sendable {
    let rows: GiftsRows
    let currentMemberID: String?

    /// Filters `rows` to what `currentMemberID` may see.
    init(rows: GiftsRows, currentMemberID: String?) {
        self.rows = rows.visible(to: currentMemberID)
        self.currentMemberID = currentMemberID
    }

    var presentation: GiftsPresentation {
        GiftsPresentation(rows: rows, currentMemberID: currentMemberID)
    }
}

/// The gift columns a form writes. A `nil` field is left out; `.null`
/// clears the column, as the PWA's explicit `null` does.
struct GiftValues: Encodable, Sendable, Equatable {
    enum Field: Equatable, Sendable {
        case text(String), cents(Int), null
    }

    var fields: [String: Field] = [:]

    private struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ name: String) { stringValue = name }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        for (name, field) in fields {
            switch field {
            case .text(let value): try container.encode(value, forKey: Key(name))
            case .cents(let value): try container.encode(value, forKey: Key(name))
            case .null: try container.encodeNil(forKey: Key(name))
            }
        }
    }

    /// The fields every purchase form supplies.
    static func details(amountCents: Int, description: String, purchasedOn: String) -> Self {
        Self(fields: [
            "amount_cents": .cents(amountCents),
            "description": .text(description.trimmingCharacters(in: .whitespaces)),
            "purchased_on": .text(purchasedOn),
        ])
    }

    func with(_ name: String, _ field: Field) -> Self {
        var copy = self
        copy.fields[name] = field
        return copy
    }
}

/// Loads the household's gift rows, publishes the screen's content and performs
/// its writes through `NestData`, reloading after each.
@MainActor @Observable
final class GiftsViewModel {
    private(set) var state: ScreenState<GiftsContent> = .loading
    /// The message for the last failed write or Up refresh, until the next attempt.
    private(set) var actionError: String?
    private(set) var isSyncing = false

    private let data: NestData
    private let syncUp: @Sendable () async throws -> Void

    init(
        data: NestData = .live,
        syncUp: @escaping @Sendable () async throws -> Void = {
            let _: SupabaseAPI.Ignored = try await SupabaseAPI.live.invoke("up-sync")
        }
    ) {
        self.data = data
        self.syncUp = syncUp
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let userID = try? await data.userID()
        let stream = RowsCombiner.stream(
            initial: GiftsRows(), sources: GiftsRows.sources, data: data)
        do {
            for try await snapshot in stream {
                let memberID = snapshot.rows.members.first { $0.userId == userID }?.id
                state = .loaded(
                    GiftsContent(rows: snapshot.rows, currentMemberID: memberID),
                    isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let content = state.value {
                state = .loaded(content, isRefreshing: false, refreshError: failure)
            } else {
                state = .failed(failure)
            }
        }
    }

    /// Discards the shown state and loads again.
    func retry() async {
        if state.value == nil { state = .loading }
        await load()
    }

    /// Pulls fresh gift transactions from Up, then reloads.
    func refreshFromUp() async {
        isSyncing = true
        actionError = nil
        defer { isSyncing = false }
        do {
            try await syncUp()
        } catch {
            actionError = "Could not refresh from Up. Try again."
            return
        }
        await load()
    }

    // MARK: Writes

    /// Sets a candidate aside as "not a gift".
    func dismiss(transactionID: String) async -> Bool {
        guard let household else { return false }
        return await write("Could not set this aside. Please try again.") {
            try await data.insert(
                GiftTransactionDismissal.self,
                values: DismissalValues(householdId: household, transactionId: transactionID),
                also: ["transactions"])
        }
    }

    /// Undoes a set-aside, returning its transaction to the inbox.
    func restore(dismissalID: String) async -> Bool {
        await write("Could not undo this. Please try again.") {
            try await data.delete(
                GiftTransactionDismissal.self, filters: [.eq("id", dismissalID)],
                also: ["transactions"])
        }
    }

    /// Records a purchase; the household is added here.
    func createPurchase(_ values: GiftValues) async -> Bool {
        guard let household else { return false }
        return await write("Could not save this purchase. Please try again.") {
            try await data.insert(
                GiftPurchase.self,
                values: values.with("household_id", .text(household)), also: ["transactions"])
        }
    }

    /// Changes the given columns of a purchase.
    func updatePurchase(id: String, _ values: GiftValues) async -> Bool {
        await write("Could not save this purchase. Please try again.") {
            try await data.update(
                GiftPurchase.self, values: values, filters: [.eq("id", id)], also: ["transactions"])
        }
    }

    func deletePurchase(id: String) async -> Bool {
        await write("Could not delete this purchase. Please try again.") {
            try await data.delete(
                GiftPurchase.self, filters: [.eq("id", id)], also: ["transactions"])
        }
    }

    // MARK: Recipients, occasions and budgets

    /// Adds an external recipient: members are permanent recipients made with
    /// the member, so a recipient added here is never linked to one.
    func createRecipient(name: String) async -> Bool {
        guard let household else { return false }
        return await write("Could not save. Please try again.") {
            try await data.insert(
                GiftRecipient.self,
                values: GiftValues(fields: [
                    "household_id": .text(household), "name": .text(name), "member_id": .null,
                ]), also: ["budget_line"])
        }
    }

    /// Renames an external recipient.
    func updateRecipient(id: String, name: String) async -> Bool {
        await write("Could not save. Please try again.") {
            try await data.update(
                GiftRecipient.self,
                values: GiftValues(fields: ["name": .text(name), "member_id": .null]),
                filters: [.eq("id", id)], also: ["budget_line"])
        }
    }

    /// Deletes an external recipient, cascading to its budgets and their purchases.
    func deleteRecipient(id: String) async -> Bool {
        await write("Could not delete this recipient. Please try again.") {
            try await data.delete(
                GiftRecipient.self, filters: [.eq("id", id)], also: Self.cascade)
        }
    }

    func createOccasion(name: String, date: String?) async -> Bool {
        guard let household else { return false }
        return await write("Could not save. Please try again.") {
            try await data.insert(
                GiftOccasion.self,
                values: Self.occasion(name: name, date: date).with("household_id", .text(household)),
                also: ["budget_line"])
        }
    }

    func updateOccasion(id: String, name: String, date: String?) async -> Bool {
        await write("Could not save. Please try again.") {
            try await data.update(
                GiftOccasion.self, values: Self.occasion(name: name, date: date),
                filters: [.eq("id", id)], also: ["budget_line"])
        }
    }

    /// Deletes an occasion, cascading to its budgets and their purchases.
    func deleteOccasion(id: String) async -> Bool {
        await write("Could not delete this occasion. Please try again.") {
            try await data.delete(GiftOccasion.self, filters: [.eq("id", id)], also: Self.cascade)
        }
    }

    /// Adds a gift budget from a checked draft; the household is added here.
    func createBudget(_ check: GiftBudgetDraftCheck) async -> Bool {
        guard let household else { return false }
        return await write("Could not save this gift budget. Please try again.") {
            try await data.insert(
                GiftBudget.self, values: check.values.with("household_id", .text(household)),
                also: ["budget_line"])
        }
    }

    /// Saves a gift budget's amount and date. A recipient may edit the agreed
    /// amount of their own gift, as the PWA allows.
    func updateBudget(id: String, _ check: GiftBudgetDraftCheck) async -> Bool {
        await write("Could not save this gift budget. Please try again.") {
            try await data.update(
                GiftBudget.self, values: check.values, filters: [.eq("id", id)],
                also: ["budget_line"])
        }
    }

    /// Deletes a gift budget, cascading to its purchases.
    func deleteBudget(id: String) async -> Bool {
        await write("Could not delete this gift budget. Please try again.") {
            try await data.delete(GiftBudget.self, filters: [.eq("id", id)], also: Self.cascade)
        }
    }

    /// Every table a recipient, occasion or budget delete reaches.
    private static let cascade: Set<String> = ["budget_line", "gift_budget", "gift_purchase", "transactions"]

    private static func occasion(name: String, date: String?) -> GiftValues {
        GiftValues(fields: ["name": .text(name), "occasion_date": date.map { .text($0) } ?? .null])
    }

    /// Creates the household's ad hoc buffer row, or replaces its amount.
    func setDiscretionaryBudget(cents: Int) async -> Bool {
        guard let household else { return false }
        let existing = state.value?.rows.discretionaryBudget
        return await write("Could not save this budget. Please try again.") {
            if let existing {
                try await data.update(
                    GiftDiscretionaryBudget.self, values: ["budgeted_amount_cents": cents],
                    filters: [.eq("id", existing.id)], also: ["budget_line"])
            } else {
                try await data.insert(
                    GiftDiscretionaryBudget.self,
                    values: DiscretionaryValues(householdId: household, budgetedAmountCents: cents),
                    also: ["budget_line"])
            }
        }
    }

    private var household: String? { state.value?.rows.members.first?.householdId }

    private func write<R>(_ message: String, _ operation: () async throws -> R) async -> Bool {
        actionError = nil
        do {
            _ = try await operation()
        } catch {
            actionError = message
            await load()
            return false
        }
        await load()
        return true
    }

    private struct DismissalValues: Encodable, Sendable {
        let householdId: String
        let transactionId: String
        enum CodingKeys: String, CodingKey {
            case householdId = "household_id"
            case transactionId = "transaction_id"
        }
    }

    private struct DiscretionaryValues: Encodable, Sendable {
        let householdId: String
        let budgetedAmountCents: Int
        enum CodingKeys: String, CodingKey {
            case householdId = "household_id"
            case budgetedAmountCents = "budgeted_amount_cents"
        }
    }
}
