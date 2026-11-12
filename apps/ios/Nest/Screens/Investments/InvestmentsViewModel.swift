import Foundation
import Observation

/// What the Investments screen renders once loaded: the rows and their portfolio.
struct InvestmentsContent: Equatable, Sendable {
    let rows: InvestmentsRows
    let portfolio: Portfolio
}

/// Loads the household's trades, members and documents through the cache, derives
/// holdings and gains in the engine, and writes trades.
@MainActor @Observable
final class InvestmentsViewModel {
    private(set) var state: ScreenState<InvestmentsContent> = .loading

    private let data: NestData
    private let derive: @Sendable (PortfolioInput) async throws -> Portfolio
    private let figures: @Sendable (TradeFiguresInput) async throws -> TradeFigures

    init(
        data: NestData = .live,
        derive: @escaping @Sendable (PortfolioInput) async throws -> Portfolio =
            ScreenEngine.portfolio,
        figures: @escaping @Sendable (TradeFiguresInput) async throws -> TradeFigures =
            ScreenEngine.tradeFigures
    ) {
        self.data = data
        self.derive = derive
        self.figures = figures
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: InvestmentsRows(), sources: InvestmentsRows.sources, data: data)
        do {
            for try await snapshot in stream {
                let portfolio = try await derive(snapshot.rows.input)
                state = .loaded(
                    InvestmentsContent(rows: snapshot.rows, portfolio: portfolio),
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

    /// The form's typed amounts as stored figures.
    func figures(for input: TradeFiguresInput) async -> TradeFigures? {
        try? await figures(input)
    }

    /// Adds a trade (or, with `id`, changes it), then reloads.
    func save(_ input: TradeInput, id: String? = nil) async throws {
        if let id {
            try await data.update(Trade.self, values: input, filters: [.eq("id", id)])
        } else {
            guard let household = state.value?.rows.householdID else {
                throw NestError(.invalidRequest)
            }
            try await data.insert(
                Trade.self, values: TradeInsert(householdID: household, input: input))
        }
        await load()
    }

    /// Deletes a trade, then reloads.
    func remove(id: String) async throws {
        try await data.delete(Trade.self, filters: [.eq("id", id)])
        await load()
    }

    /// A short-lived URL for the stored document at `path`.
    func documentURL(path: String) async throws -> URL {
        try await data.api.signedURL(bucket: "receipts", path: path)
    }
}
