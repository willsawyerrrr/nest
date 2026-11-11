import Foundation
import Observation

/// What the Pay splits screen renders once loaded.
struct SplitsContent: Equatable, Sendable {
    let rows: SplitsRows
    let routes: PaySplitRoutes
}

/// Loads the household's routing rows through the cache, routes them in the
/// engine and publishes the result. Also performs the screen's writes: setting
/// the pay account, confirming a split and clearing one.
@MainActor @Observable
final class SplitsViewModel {
    private(set) var state: ScreenState<SplitsContent> = .loading
    /// The fixed message of the last write that failed; nil once a write succeeds.
    private(set) var actionError: NestError?

    private let data: NestData
    private let route: @Sendable (PaySplitRoutesInput) async throws -> PaySplitRoutes
    private let now: @Sendable () -> Date

    init(
        data: NestData = .live,
        route: @escaping @Sendable (PaySplitRoutesInput) async throws -> PaySplitRoutes =
            ScreenEngine.paySplitRoutes,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.data = data
        self.route = route
        self.now = now
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: SplitsRows(),
            sources: SplitsRows.sources(financialYear: FinancialYear.containing(now())),
            data: data)
        do {
            for try await snapshot in stream {
                let routes = try await route(snapshot.rows.input)
                state = .loaded(
                    SplitsContent(rows: snapshot.rows, routes: routes),
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

    /// Designates the household's pay account, or clears it with `nil`.
    func setPayAccount(_ accountID: String?) async {
        await write {
            try await data.call(
                "set_household_pay_account", params: PayAccountParams(accountID: accountID),
                invalidating: [Household.table])
        }
    }

    /// Records `fortnightlyCents` as the split the household has set for the account.
    func confirm(accountID: String, fortnightlyCents: Int) async {
        guard let householdID = state.value?.rows.household?.id else { return }
        let values = PaySplitValues(
            householdID: householdID, accountID: accountID,
            confirmedFortnightlyCents: fortnightlyCents,
            confirmedAt: SummaryRows.iso(now()))
        await write {
            try await data.upsert(
                PaySplit.self, values: values, onConflict: "household_id,account_id")
        }
    }

    /// Deletes the account's confirmed split.
    func clear(accountID: String) async {
        await write {
            try await data.delete(PaySplit.self, filters: [.eq("account_id", accountID)])
        }
    }

    private func write<R>(_ operation: () async throws -> R) async {
        do {
            _ = try await operation()
            actionError = nil
        } catch {
            actionError = (NestError.from(error) as? NestError) ?? NestError(.unknown)
        }
        await load()
    }
}

/// `set_household_pay_account`'s argument; a cleared account is sent as an
/// explicit `null`, as the RPC reads it.
struct PayAccountParams: Encodable, Sendable, Equatable {
    let accountID: String?

    enum CodingKeys: String, CodingKey { case accountID = "p_account_id" }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(accountID, forKey: .accountID)
    }
}

/// The `pay_split` row an upsert writes.
struct PaySplitValues: Encodable, Sendable, Equatable {
    let householdID: String
    let accountID: String
    let confirmedFortnightlyCents: Int
    let confirmedAt: String

    enum CodingKeys: String, CodingKey {
        case householdID = "household_id"
        case accountID = "account_id"
        case confirmedFortnightlyCents = "confirmed_fortnightly_cents"
        case confirmedAt = "confirmed_at"
    }
}
