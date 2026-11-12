import Foundation
import Observation

/// What the Net worth screen renders once loaded.
struct NetWorthContent: Equatable, Sendable {
    let outcome: NetWorthOutcome
    /// The outcome of the real rows while planning mode is on, to compare against.
    var baseline: NetWorthOutcome?
    let horizon: ProjectionHorizon
}

/// Loads the household's rows through the cache, runs the net worth and its
/// projection in the engine and publishes them; also saves an account's inclusion
/// in net worth.
@MainActor @Observable
final class NetWorthViewModel {
    private(set) var state: ScreenState<NetWorthContent> = .loading
    private(set) var actionError: NestError?
    var horizon: ProjectionHorizon {
        didSet {
            defaults.set(horizon.rawValue, forKey: ProjectionHorizon.storageKey)
            Task { await recompute() }
        }
    }

    private let data: NestData
    private let compute: @Sendable (NetWorthInput) async throws -> NetWorthOutcome
    private let now: @Sendable () -> Date
    private let defaults: UserDefaults
    private let planning: PlanningStore
    private var snapshot: NetWorthRows?

    init(
        data: NestData = .live,
        compute: @escaping @Sendable (NetWorthInput) async throws -> NetWorthOutcome =
            ScreenEngine.netWorth,
        now: @escaping @Sendable () -> Date = Date.init,
        defaults: UserDefaults = .standard,
        planning: PlanningStore = .shared
    ) {
        self.data = data
        self.compute = compute
        self.now = now
        self.defaults = defaults
        self.planning = planning
        horizon =
            defaults.string(forKey: ProjectionHorizon.storageKey).flatMap(ProjectionHorizon.init)
            ?? .retirement
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: NetWorthRows(),
            sources: NetWorthRows.sources(financialYear: FinancialYear.containing(now())),
            data: data)
        do {
            for try await rows in stream {
                snapshot = rows.rows
                state = .loaded(
                    try await content(for: rows.rows), isRefreshing: rows.isCached,
                    refreshError: nil)
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

    /// Includes or excludes an account from net worth, for the whole household.
    func setExcluded(_ excluded: Bool, accountID: String) async {
        actionError = nil
        do {
            _ = try await data.update(
                Account.self, values: ExclusionValues(excluded: excluded),
                filters: [.eq("id", accountID)], also: [AccountWithBalance.table])
            await load()
        } catch {
            actionError = (NestError.from(error) as? NestError) ?? NestError(.unknown)
        }
    }

    private func recompute() async {
        guard let rows = snapshot, case .loaded(_, let refreshing, let error) = state else { return }
        if let content = try? await content(for: rows) {
            state = .loaded(content, isRefreshing: refreshing, refreshError: error)
        }
    }

    private func content(for real: NetWorthRows) async throws -> NetWorthContent {
        planning.select(household: real.members.first?.householdId)
        let instant = now()
        let sandbox = planning.state
        let rows = sandbox.active ? real.sandboxed(by: sandbox) : real
        let outcome = try await compute(rows.input(horizon: horizon, now: instant))
        let baseline =
            sandbox.active ? try await compute(real.input(horizon: horizon, now: instant)) : nil
        return NetWorthContent(outcome: outcome, baseline: baseline, horizon: horizon)
    }
}

/// The body of an account's exclusion write.
private struct ExclusionValues: Encodable, Sendable {
    let excluded: Bool

    enum CodingKeys: String, CodingKey { case excluded = "exclude_from_net_worth" }
}
