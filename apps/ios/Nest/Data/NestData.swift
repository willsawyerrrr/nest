import Foundation

/// What a screen renders: the rows, and whether they came from the cache and a
/// refresh is still to arrive.
struct Snapshot<Row: Sendable>: Sendable {
    let rows: [Row]
    let isCached: Bool
}

/// The data layer screens use: cache-first reads over `SupabaseAPI`, and writes
/// that invalidate the cached queries they affect.
struct NestData: Sendable {
    var api: SupabaseAPI
    var cache: RowCache
    /// The signed-in user's id, the cache scope. Throws when signed out.
    var userID: @Sendable () async throws -> String

    /// The app's instance. Creating it starts clearing the cache on sign-out
    /// (cache entries are also scoped per user id).
    static let live: NestData = {
        let data = NestData(
            api: .live,
            cache: RowCache(),
            userID: { try await supabaseAuth.session.user.id.uuidString }
        )
        Task {
            await data.clearCacheOnSignOut(
                supabaseAuth.authStateChanges.map { $0.session != nil }
            )
        }
        return data
    }()

    /// Yields the cached rows first (when there are any), then the fetched rows,
    /// which replace the cache. A failed fetch ends the stream with a
    /// `NestError` after any cached snapshot, so the screen can keep showing it.
    /// With `cached` off the cache is neither read nor written, for rows that
    /// row-level security can withdraw from the signed-in user between fetches.
    func rows<T: NestRow>(
        _ type: T.Type, filters: [Filter] = [], order: [Order] = [], limit: Int? = nil,
        cached: Bool = true
    ) -> AsyncThrowingStream<Snapshot<T>, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let user = try await scope()
                    let key = QueryKey(table: T.table, filters: filters, order: order, limit: limit)
                    if cached, let rows = await cache.read(T.self, key: key, user: user) {
                        continuation.yield(Snapshot(rows: rows, isCached: true))
                    }
                    let fresh = try await api.select(
                        T.self, filters: filters, order: order, limit: limit)
                    if cached { await cache.write(fresh, key: key, user: user) }
                    continuation.yield(Snapshot(rows: fresh, isCached: false))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: NestError.from(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Inserts rows, then invalidates `T`'s table and `also`.
    @discardableResult
    func insert<T: NestRow>(
        _ type: T.Type, values: some Encodable & Sendable, also: Set<String> = []
    ) async throws -> [T] {
        try await write(invalidating: also.union([T.table])) {
            try await api.insert(T.self, values: values)
        }
    }

    /// Inserts rows, or updates those already holding the same `onConflict`
    /// columns, then invalidates `T`'s table and `also`.
    @discardableResult
    func upsert<T: NestRow>(
        _ type: T.Type, values: some Encodable & Sendable, onConflict: String,
        also: Set<String> = []
    ) async throws -> [T] {
        try await write(invalidating: also.union([T.table])) {
            try await api.upsert(T.self, values: values, onConflict: onConflict)
        }
    }

    /// Updates matching rows, then invalidates `T`'s table and `also`.
    @discardableResult
    func update<T: NestRow>(
        _ type: T.Type, values: some Encodable & Sendable, filters: [Filter], also: Set<String> = []
    ) async throws -> [T] {
        try await write(invalidating: also.union([T.table])) {
            try await api.update(T.self, values: values, filters: filters)
        }
    }

    /// Deletes matching rows, then invalidates `T`'s table and `also`.
    func delete<T: NestRow>(
        _ type: T.Type, filters: [Filter], also: Set<String> = []
    ) async throws {
        try await write(invalidating: also.union([T.table])) {
            try await api.delete(T.self, filters: filters)
        }
    }

    /// Calls a Postgres function that writes, then invalidates `tables` (the
    /// tables the function touches).
    func call(
        _ name: String, params: some Encodable & Sendable = SupabaseAPI.EmptyBody(),
        invalidating tables: Set<String>
    ) async throws {
        try await write(invalidating: tables) { try await api.call(name, params: params) }
    }

    /// Calls the edge function `name` with `body` and decodes its response, then
    /// invalidates `tables` (the tables the function touches).
    func invoke<R: Decodable & Sendable>(
        _ name: String, body: some Encodable & Sendable, invalidating tables: Set<String>,
        as _: R.Type = R.self
    ) async throws -> R {
        try await write(invalidating: tables) { try await api.invoke(name, body: body) }
    }

    /// Empties the cache for every user.
    func clearCache() async {
        await cache.clear()
    }

    /// Runs a write, then drops the cached queries of `tables`. A failed write
    /// invalidates too, since the server may have applied it before the error.
    private func write<R>(
        invalidating tables: Set<String>, _ operation: () async throws -> R
    ) async throws -> R {
        let user = try await scope()
        do {
            let result = try await operation()
            await cache.invalidate(tables: tables, user: user)
            return result
        } catch {
            await cache.invalidate(tables: tables, user: user)
            throw error
        }
    }

    /// Clears the cache whenever `isSignedIn` yields `false`.
    func clearCacheOnSignOut<S: AsyncSequence & Sendable>(_ isSignedIn: S) async
    where S.Element == Bool {
        do { for try await signedIn in isSignedIn where !signedIn { await cache.clear() } } catch {}
    }

    private func scope() async throws -> String {
        do { return try await userID() } catch { throw NestError(.unauthenticated) }
    }
}
