import Foundation
import Observation

/// What the Budget and Allowance screens render once loaded.
struct BudgetContent: Equatable, Sendable {
    let rows: BudgetRows
    let overview: BudgetOverview
    /// The signed-in member, the only one whose allowance shows what is drawn.
    let currentMemberID: String?
    let now: Date
}

/// Loads the household's budget rows through the cache, runs the figures in the
/// engine and publishes the result. Budget and Allowance share it: each screen
/// projects `BudgetContent` its own way.
@MainActor @Observable
final class BudgetViewModel {
    private(set) var state: ScreenState<BudgetContent> = .loading

    private let data: NestData
    private let overview: @Sendable (BudgetOverviewInput) async throws -> BudgetOverview
    private let now: @Sendable () -> Date
    private let planning: PlanningStore

    init(
        data: NestData = .live,
        overview: @escaping @Sendable (BudgetOverviewInput) async throws -> BudgetOverview =
            ScreenEngine.budgetOverview,
        now: @escaping @Sendable () -> Date = Date.init,
        planning: PlanningStore = .shared
    ) {
        self.planning = planning
        self.data = data
        self.overview = overview
        self.now = now
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let instant = now()
        let userID = try? await data.userID()
        let stream = RowsCombiner.stream(
            initial: BudgetRows(), sources: BudgetRows.sources, data: data)
        do {
            for try await snapshot in stream {
                planning.select(household: snapshot.rows.members.first?.householdId)
                let rows =
                    planning.state.active ? snapshot.rows.sandboxed(by: planning.state) : snapshot.rows
                let figures = try await overview(rows.input(now: instant))
                let content = BudgetContent(
                    rows: rows, overview: figures,
                    currentMemberID: rows.members.first { $0.userId == userID }?.id,
                    now: instant)
                state = .loaded(content, isRefreshing: snapshot.isCached, refreshError: nil)
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
