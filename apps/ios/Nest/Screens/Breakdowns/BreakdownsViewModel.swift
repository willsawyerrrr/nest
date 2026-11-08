import Foundation
import Observation

/// What the Breakdowns screens render once loaded: the rows and their roll-up.
struct BreakdownsContent: Equatable, Sendable {
    let rows: BreakdownsRows
    let rollups: BreakdownRollups
}

/// Loads the household's breakdowns and items through the cache, rolls them up in
/// the engine and publishes the result for the list and every detail screen.
@MainActor @Observable
final class BreakdownsViewModel {
    private(set) var state: ScreenState<BreakdownsContent> = .loading

    private let data: NestData
    private let rollUp: @Sendable (BreakdownsInput) async throws -> BreakdownRollups

    init(
        data: NestData = .live,
        rollUp: @escaping @Sendable (BreakdownsInput) async throws -> BreakdownRollups =
            ScreenEngine.summariseBreakdowns
    ) {
        self.data = data
        self.rollUp = rollUp
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: BreakdownsRows(), sources: BreakdownsRows.sources, data: data)
        do {
            for try await snapshot in stream {
                let rollups = try await rollUp(snapshot.rows.input)
                state = .loaded(
                    BreakdownsContent(rows: snapshot.rows, rollups: rollups),
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
