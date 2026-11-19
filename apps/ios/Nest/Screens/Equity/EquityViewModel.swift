import Foundation
import Observation

/// What the Equity screen renders once loaded: the rows and each grant's figures.
struct EquityContent: Equatable, Sendable {
    let rows: EquityRows
    let figures: [GrantFigures]
}

/// Loads the household's equity grants, exercises and sales through the cache, runs
/// the vesting and valuation figures in the engine, publishes the result and writes
/// grants, exercises and sales.
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

    /// Adds a grant (or, with `id`, changes it), then reloads.
    func saveGrant(_ input: EquityGrantInput, id: String? = nil) async throws {
        try await save(EquityGrant.self, input, id: id)
    }

    /// Records an exercise (or, with `id`, changes it), then reloads.
    func saveExercise(_ input: EquityExerciseInput, id: String? = nil) async throws {
        try await save(EquityExercise.self, input, id: id)
    }

    /// Records a sale (or, with `id`, changes it), then reloads.
    func saveSale(_ input: EquitySaleInput, id: String? = nil) async throws {
        try await save(EquitySale.self, input, id: id)
    }

    /// Deletes a grant (its exercises and sales cascade with it), then reloads.
    func removeGrant(id: String) async throws {
        try await data.delete(
            EquityGrant.self, filters: [.eq("id", id)],
            also: [EquityExercise.table, EquitySale.table])
        await load()
    }

    /// Deletes an exercise, then reloads.
    func removeExercise(id: String) async throws {
        try await data.delete(EquityExercise.self, filters: [.eq("id", id)])
        await load()
    }

    /// Deletes a sale, then reloads.
    func removeSale(id: String) async throws {
        try await data.delete(EquitySale.self, filters: [.eq("id", id)])
        await load()
    }

    /// Updates row `id` of `T` to `input`, or inserts it into the household, then reloads.
    private func save<T: NestRow, Input: Encodable & Sendable>(
        _ type: T.Type, _ input: Input, id: String?
    ) async throws {
        if let id {
            try await data.update(T.self, values: input, filters: [.eq("id", id)])
        } else {
            guard let household = state.value?.rows.householdID else {
                throw NestError(.invalidRequest)
            }
            try await data.insert(
                T.self, values: EquityInsert(householdID: household, input: input))
        }
        await load()
    }
}
