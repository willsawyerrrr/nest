import Foundation
import Observation

/// What the Equity screen renders once loaded: the rows and each grant's figures.
struct EquityContent: Equatable, Sendable {
    let rows: EquityRows
    let figures: [GrantFigures]
}

/// Loads the household's equity grants, exercises and sales through the cache, runs
/// the vesting and valuation figures in the engine and publishes the result.
@MainActor @Observable
final class EquityViewModel {
    private(set) var state: ScreenState<EquityContent> = .loading

    private let data: NestData
    private let summarise: @Sendable (EquityInput) async throws -> [GrantFigures]
    private let now: @Sendable () -> Date

    init(
        data: NestData = .live,
        summarise: @escaping @Sendable (EquityInput) async throws -> [GrantFigures] =
            ScreenEngine.summariseEquity,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.data = data
        self.summarise = summarise
        self.now = now
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let instant = now()
        let stream = RowsCombiner.stream(
            initial: EquityRows(), sources: EquityRows.sources, data: data)
        do {
            for try await snapshot in stream {
                let figures = try await summarise(snapshot.rows.input(now: instant))
                state = .loaded(
                    EquityContent(rows: snapshot.rows, figures: figures),
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
