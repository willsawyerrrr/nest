import Foundation

/// A screen's rows at one instant, and whether any table is still showing cached rows.
struct ScreenSnapshot<Rows: Sendable>: Sendable {
    let rows: Rows
    let isCached: Bool
}

/// One table feeding a screen's `Rows`: how to read it through `NestData` and
/// where its rows land.
struct TableSource<Rows: Sendable>: Sendable {
    let run: @Sendable (NestData, @Sendable (_ apply: @Sendable (inout Rows) -> Void, _ isCached: Bool) async -> Void) async throws -> Void

    /// Reads `T` with `filters` and stores each snapshot with `assign`. With
    /// `cached` off the rows bypass the cache (see `NestData.rows`).
    static func table<T: NestRow>(
        _ type: T.Type, filters: [Filter] = [], order: [Order] = [], cached: Bool = true,
        assign: @escaping @Sendable (inout Rows, [T]) -> Void
    ) -> TableSource {
        TableSource { data, report in
            for try await snapshot in data.rows(T.self, filters: filters, order: order, cached: cached) {
                await report({ assign(&$0, snapshot.rows) }, snapshot.isCached)
            }
        }
    }
}

/// Merges several tables' cached-then-fresh streams into one stream of whole
/// `Rows`. Nothing is emitted until every table has produced a snapshot (cached or
/// fresh); after that every arriving snapshot emits again, with `isCached` true
/// until every table's fresh fetch has landed. The first failing table ends the
/// stream with its error after any snapshots already emitted.
enum RowsCombiner {
    static func stream<Rows: Sendable>(
        initial: Rows, sources: [TableSource<Rows>], data: NestData
    ) -> AsyncThrowingStream<ScreenSnapshot<Rows>, Error> {
        AsyncThrowingStream { continuation in
            let accumulator = Accumulator(initial: initial, count: sources.count)
            let task = Task {
                do {
                    try await withThrowingTaskGroup(of: Void.self) { group in
                        for (index, source) in sources.enumerated() {
                            group.addTask {
                                try await source.run(data) { apply, isCached in
                                    if let snapshot = await accumulator.record(
                                        index, apply: apply, isCached: isCached)
                                    {
                                        continuation.yield(snapshot)
                                    }
                                }
                            }
                        }
                        try await group.waitForAll()
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: NestError.from(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private actor Accumulator<Rows: Sendable> {
        private var rows: Rows
        private let count: Int
        private var seen: Set<Int> = []
        private var fresh: Set<Int> = []

        init(initial: Rows, count: Int) {
            rows = initial
            self.count = count
        }

        func record(
            _ index: Int, apply: @Sendable (inout Rows) -> Void, isCached: Bool
        ) -> ScreenSnapshot<Rows>? {
            apply(&rows)
            seen.insert(index)
            if !isCached { fresh.insert(index) }
            guard seen.count == count else { return nil }
            return ScreenSnapshot(rows: rows, isCached: fresh.count < count)
        }
    }
}
