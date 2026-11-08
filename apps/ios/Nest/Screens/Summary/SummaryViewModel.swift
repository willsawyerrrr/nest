import Foundation
import Observation

/// What the Summary screen renders once loaded.
struct SummaryContent: Equatable, Sendable {
    let summary: BudgetSummary
    let members: [Member]
    /// The Summary of the real rows while planning mode is on, to compare against.
    var baseline: BudgetSummary?
}

/// Loads the household's rows through the cache, runs the reconciliation in the
/// engine and publishes the result. The pattern every native screen follows:
/// rows stream in cached-then-fresh, each snapshot is reduced to the screen's
/// content, and `state` carries loading, loaded (refreshing or stale) and failed.
@MainActor @Observable
final class SummaryViewModel {
    private(set) var state: ScreenState<SummaryContent> = .loading
    var basis: IncomeBasis {
        didSet { defaults.set(basis.rawValue, forKey: Self.basisKey) }
    }

    static let basisKey = "summary-income-basis"

    private let data: NestData
    private let summarise: @Sendable (SummaryInput) async throws -> BudgetSummary
    private let now: @Sendable () -> Date
    private let defaults: UserDefaults
    private let planning: PlanningStore

    init(
        data: NestData = .live,
        summarise: @escaping @Sendable (SummaryInput) async throws -> BudgetSummary =
            ScreenEngine.summarise,
        now: @escaping @Sendable () -> Date = Date.init,
        defaults: UserDefaults = .standard,
        planning: PlanningStore = .shared
    ) {
        self.planning = planning
        self.data = data
        self.summarise = summarise
        self.now = now
        self.defaults = defaults
        basis = defaults.string(forKey: Self.basisKey).flatMap(IncomeBasis.init) ?? .takeHome
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let instant = now()
        let stream = RowsCombiner.stream(
            initial: SummaryRows(),
            sources: SummaryRows.sources(financialYear: FinancialYear.containing(instant)),
            data: data)
        do {
            for try await snapshot in stream {
                planning.select(household: snapshot.rows.members.first?.householdId)
                let sandbox = planning.state
                let summary = try await summarise(
                    (sandbox.active ? snapshot.rows.sandboxed(by: sandbox) : snapshot.rows)
                        .input(now: instant))
                let baseline =
                    sandbox.active ? try await summarise(snapshot.rows.input(now: instant)) : nil
                state = .loaded(
                    SummaryContent(
                        summary: summary, members: snapshot.rows.members, baseline: baseline),
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
}
