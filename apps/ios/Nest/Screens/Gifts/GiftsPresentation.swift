import Foundation

/// A budgeted/spent/remaining money triple, in integer cents.
struct GiftTotals: Codable, Equatable, Sendable {
    var budgetedCents = 0
    var spentCents = 0
    var remainingCents = 0

    static func sum(_ totals: [GiftTotals]) -> GiftTotals {
        totals.reduce(into: GiftTotals()) {
            $0.budgetedCents += $1.budgetedCents
            $0.spentCents += $1.spentCents
            $0.remainingCents += $1.remainingCents
        }
    }

    /// The spend bar's fill, 0...1: full when spent against no budget.
    var progress: Double {
        if budgetedCents <= 0 { return spentCents > 0 ? 1 : 0 }
        return min(1, Double(spentCents) / Double(budgetedCents))
    }

    var isOver: Bool { remainingCents < 0 }
}

/// Which dimension the tracker groups by.
enum GiftGroupBy: String, Codable, CaseIterable, Sendable {
    case occasion, person

    var label: String { self == .occasion ? "By occasion" : "By person" }
}

/// One line within a group: the pairing's other dimension and its money.
struct GiftRow: Codable, Equatable, Sendable, Identifiable {
    var budgetId: String
    var recipientId: String
    var occasionId: String
    var label: String
    var date: String?
    var totals: GiftTotals
    /// The gift is for the signed-in member: only its budget shows.
    var isHidden = false

    var id: String { budgetId }
}

/// A group header (an occasion or a recipient) with its rolled-up money and rows.
struct GiftGroup: Codable, Equatable, Sendable, Identifiable {
    var key: String
    var label: String
    var date: String?
    var rows: [GiftRow]
    var totals: GiftTotals
    /// Every row is for the signed-in member: only the budget shows.
    var isHidden: Bool

    var id: String { key }
}

/// One unclaimed gift transaction, as the inbox renders it.
struct GiftCandidate: Codable, Equatable, Sendable, Identifiable {
    var transactionId: String
    var description: String
    var amountCents: Int
    var postedOn: String
    var pending: Bool
    /// The dismissal that undoes a set-aside candidate.
    var dismissalId: String?

    var id: String { transactionId }
    var title: String { description.isEmpty ? "Card purchase" : description }
}

/// A selectable choice: the value it submits and the label it reads as.
struct GiftLinkOption: Codable, Equatable, Sendable, Identifiable, Hashable {
    var value: String
    var label: String

    var id: String { value }
}

/// A recipient a purchase can be linked to, with the occasions they are budgeted for.
struct GiftLinkRecipient: Codable, Equatable, Sendable, Identifiable {
    var value: String
    var label: String
    /// Each occasion valued by the `gift_budget` id the pairing resolves to.
    var occasions: [GiftLinkOption]

    var id: String { value }
}

/// What the Gifts screen renders, derived from the visible rows: a port of the
/// PWA's `lib/gifts.ts` and `lib/giftCandidates.ts`, so both surfaces group,
/// total and order identically.
struct GiftsPresentation: Equatable, Sendable {
    let rows: GiftsRows
    let hiddenBudgetIDs: Set<String>

    init(rows: GiftsRows, currentMemberID: String?) {
        self.rows = rows
        hiddenBudgetIDs = rows.hiddenBudgetIDs(for: currentMemberID)
    }

    // MARK: Totals

    func spentCents(budgetID: String) -> Int {
        rows.purchases.filter { $0.giftBudgetId == budgetID }.reduce(0) { $0 + $1.amountCents }
    }

    func budgetTotals(_ budget: GiftBudget) -> GiftTotals {
        let spent = spentCents(budgetID: budget.id)
        return GiftTotals(
            budgetedCents: budget.budgetedAmountCents, spentCents: spent,
            remainingCents: budget.budgetedAmountCents - spent)
    }

    var discretionaryTotals: GiftTotals {
        let budgeted = rows.discretionaryBudget?.budgetedAmountCents ?? 0
        let spent = adHocPurchases.reduce(0) { $0 + $1.amountCents }
        return GiftTotals(
            budgetedCents: budgeted, spentCents: spent, remainingCents: budgeted - spent)
    }

    /// Every gift budget plus the ad hoc buffer.
    var overall: GiftTotals {
        .sum(rows.budgets.map(budgetTotals) + [discretionaryTotals])
    }

    /// Every gift is for the signed-in member and the buffer is empty: the total
    /// shows only its budgeted amount.
    var overallIsHidden: Bool {
        !rows.budgets.isEmpty && rows.budgets.allSatisfy { hiddenBudgetIDs.contains($0.id) }
            && (rows.discretionaryBudget?.budgetedAmountCents ?? 0) == 0
    }

    var hasTotal: Bool { !rows.budgets.isEmpty || rows.discretionaryBudget != nil }

    // MARK: Purchases

    var adHocPurchases: [GiftPurchase] {
        rows.purchases.filter { $0.giftDiscretionaryBudgetId != nil }
    }

    var unassignedPurchases: [GiftPurchase] {
        rows.purchases.filter { $0.giftBudgetId == nil && $0.giftDiscretionaryBudgetId == nil }
    }

    var unassignedSpentCents: Int { unassignedPurchases.reduce(0) { $0 + $1.amountCents } }

    func purchases(budgetID: String) -> [GiftPurchase] {
        rows.purchases.filter { $0.giftBudgetId == budgetID }
    }

    var recipientNames: [String: String] {
        Dictionary(uniqueKeysWithValues: rows.recipients.map { ($0.id, $0.name) })
    }

    // MARK: Groups

    var noEntities: Bool { rows.recipients.isEmpty && rows.occasions.isEmpty }

    func groups(by groupBy: GiftGroupBy) -> [GiftGroup] {
        let recipientByID = Dictionary(uniqueKeysWithValues: rows.recipients.map { ($0.id, $0) })
        let occasionByID = Dictionary(uniqueKeysWithValues: rows.occasions.map { ($0.id, $0) })
        let entities: [(id: String, name: String, date: String?)] =
            groupBy == .occasion
            ? rows.occasions.sorted(by: Self.occasionsInOrder).map { ($0.id, $0.name, $0.occasionDate) }
            : rows.recipients.sorted(by: Self.recipientsInOrder).map { ($0.id, $0.name, nil) }

        return entities.map { entity in
            let budgets = rows.budgets.filter {
                groupBy == .occasion ? $0.occasionId == entity.id : $0.recipientId == entity.id
            }
            var lines: [GiftRow] = budgets.compactMap { budget in
                guard let recipient = recipientByID[budget.recipientId],
                    let occasion = occasionByID[budget.occasionId]
                else { return nil }
                return GiftRow(
                    budgetId: budget.id, recipientId: budget.recipientId,
                    occasionId: budget.occasionId,
                    label: groupBy == .occasion ? recipient.name : occasion.name,
                    date: budget.eventDate ?? occasion.occasionDate,
                    totals: budgetTotals(budget),
                    isHidden: hiddenBudgetIDs.contains(budget.id))
            }
            lines.sort { a, b in
                if groupBy == .occasion {
                    return Self.recipientsInOrder(
                        recipientByID[a.recipientId]!, recipientByID[b.recipientId]!)
                }
                return Self.rowsInDateOrder(a, b)
            }
            return GiftGroup(
                key: entity.id, label: entity.name, date: entity.date, rows: lines,
                totals: .sum(lines.map(\.totals)),
                isHidden: !lines.isEmpty && lines.allSatisfy(\.isHidden))
        }
    }

    /// Budget ids already taken, as `recipient:occasion` pairs.
    var takenPairs: Set<String> {
        Set(rows.budgets.map { Self.pairKey($0.recipientId, $0.occasionId) })
    }

    static func pairKey(_ recipientID: String, _ occasionID: String) -> String {
        "\(recipientID):\(occasionID)"
    }

    // MARK: Inbox

    /// Unclaimed gift transactions, newest first.
    var candidates: [GiftCandidate] {
        let claimed = Set(rows.purchases.compactMap(\.transactionId))
            .union(rows.dismissals.map(\.transactionId))
        return rows.transactions.filter { !claimed.contains($0.id) }
            .sorted(by: Self.transactionsNewestFirst).map { Self.candidate($0, dismissalID: nil) }
    }

    /// Candidates set aside as "not a gift", newest first. A dismissal with no
    /// visible transaction behind it is dropped rather than shown blank.
    var dismissed: [GiftCandidate] {
        let dismissals = Dictionary(
            rows.dismissals.map { ($0.transactionId, $0.id) }, uniquingKeysWith: { first, _ in first })
        return rows.transactions.filter { dismissals[$0.id] != nil }
            .sorted(by: Self.transactionsNewestFirst)
            .map { Self.candidate($0, dismissalID: dismissals[$0.id]) }
    }

    /// The recipients a purchase can be linked to, name-ordered, each with their
    /// budgeted occasions in occasion order. A gift for the signed-in member is
    /// excluded, as is any recipient left with no occasion.
    var linkChoices: [GiftLinkRecipient] {
        let occasionByID = Dictionary(uniqueKeysWithValues: rows.occasions.map { ($0.id, $0) })
        var byRecipient: [String: [(occasion: GiftOccasion, budgetID: String)]] = [:]
        for budget in rows.budgets {
            guard !hiddenBudgetIDs.contains(budget.id), let occasion = occasionByID[budget.occasionId]
            else { continue }
            byRecipient[budget.recipientId, default: []].append((occasion, budget.id))
        }
        return rows.recipients.filter { byRecipient[$0.id] != nil }
            .sorted(by: Self.recipientsInOrder)
            .map { recipient in
                GiftLinkRecipient(
                    value: recipient.id, label: recipient.name,
                    occasions: byRecipient[recipient.id]!
                        .sorted { Self.occasionsInOrder($0.occasion, $1.occasion) }
                        .map { GiftLinkOption(value: $0.budgetID, label: $0.occasion.name) })
            }
    }

    /// Every recipient, name-ordered, for the ad hoc tag.
    var tagChoices: [GiftLinkOption] {
        rows.recipients.sorted(by: Self.recipientsInOrder).map {
            GiftLinkOption(value: $0.id, label: $0.name)
        }
    }

    // MARK: Ordering

    static func occasionsInOrder(_ a: GiftOccasion, _ b: GiftOccasion) -> Bool {
        if a.occasionDate != b.occasionDate {
            guard let x = a.occasionDate else { return false }
            guard let y = b.occasionDate else { return true }
            return x < y
        }
        return namesInOrder(a.name, a.id, b.name, b.id)
    }

    static func recipientsInOrder(_ a: GiftRecipient, _ b: GiftRecipient) -> Bool {
        namesInOrder(a.name, a.id, b.name, b.id)
    }

    private static func rowsInDateOrder(_ a: GiftRow, _ b: GiftRow) -> Bool {
        if a.date != b.date {
            guard let x = a.date else { return false }
            guard let y = b.date else { return true }
            return x < y
        }
        return namesInOrder(a.label, a.budgetId, b.label, b.budgetId)
    }

    private static func namesInOrder(_ a: String, _ aID: String, _ b: String, _ bID: String)
        -> Bool
    {
        let order = a.compare(b, locale: Locale(identifier: "en_AU"))
        return order == .orderedSame ? aID.compare(bID) == .orderedAscending : order == .orderedAscending
    }

    private static func transactionsNewestFirst(_ a: GiftTransaction, _ b: GiftTransaction) -> Bool {
        a.postedAt == b.postedAt ? a.id < b.id : a.postedAt > b.postedAt
    }

    private static func candidate(_ transaction: GiftTransaction, dismissalID: String?)
        -> GiftCandidate
    {
        GiftCandidate(
            transactionId: transaction.id, description: transaction.description,
            amountCents: abs(transaction.amountCents), postedOn: localDate(transaction.postedAt),
            pending: transaction.status == "pending", dismissalId: dismissalID)
    }

    /// The local calendar date (`YYYY-MM-DD`) of an ISO timestamp, as `isoDate`
    /// draws it on the web.
    static func localDate(_ timestamp: String, calendar: Calendar = .current) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let instant = fractional.date(from: timestamp)
            ?? ISO8601DateFormatter().date(from: timestamp)
        else { return String(timestamp.prefix(10)) }
        let parts = calendar.dateComponents([.year, .month, .day], from: instant)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    // MARK: Copy

    /// The date as the PWA's `formatIsoDate` writes it (`28 Feb 2027`).
    static func date(_ iso: String) -> String { BudgetPresentation.date(iso) }
}
