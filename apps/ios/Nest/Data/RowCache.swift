import CryptoKit
import Foundation

/// Identifies one cached query: a table and a stable description of the
/// filters, order and limit that produced the rows.
struct QueryKey: Hashable, Sendable {
    let table: String
    let query: String

    init(table: String, filters: [Filter] = [], order: [Order] = [], limit: Int? = nil) {
        self.table = table
        let parts =
            filters.map { "\($0.column)=\($0.op).\($0.value)" }.sorted()
            + order.map { "order:\($0.column).\($0.ascending ? "asc" : "desc")" }
            + (limit.map { ["limit:\($0)"] } ?? [])
        query = parts.joined(separator: "&")
    }

    /// `<table>__<digest of query>.json`, so a table's entries share a prefix.
    var fileName: String {
        let digest = SHA256.hash(data: Data(query.utf8)).map { String(format: "%02x", $0) }.joined()
        return "\(table)__\(digest.prefix(32)).json"
    }
}

/// Persists the last-fetched rows of each query as JSON files under
/// `<directory>/<user id>/`, so a screen can render instantly from the previous
/// fetch. Entries are scoped per user and live in the system caches directory,
/// which the OS may purge; a missing or unreadable entry is a cache miss.
actor RowCache {
    private let directory: URL
    private let fileManager = FileManager.default

    /// The default location, `Caches/NestRows`, which exists on iOS, Catalyst and macOS alike.
    static let defaultDirectory = FileManager.default
        .urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("NestRows", isDirectory: true)

    init(directory: URL = RowCache.defaultDirectory) {
        self.directory = directory
    }

    func read<T: Decodable>(_: T.Type, key: QueryKey, user: String) -> [T]? {
        guard let data = try? Data(contentsOf: file(key, user: user)) else { return nil }
        return try? JSONDecoder().decode([T].self, from: data)
    }

    func write<T: Encodable>(_ rows: [T], key: QueryKey, user: String) {
        let url = file(key, user: user)
        try? fileManager.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try? JSONEncoder().encode(rows).write(to: url, options: .atomic)
    }

    /// Drops every cached query of `tables` for `user`.
    func invalidate(tables: Set<String>, user: String) {
        let folder = directory.appendingPathComponent(user, isDirectory: true)
        let names = (try? fileManager.contentsOfDirectory(atPath: folder.path)) ?? []
        for name in names where tables.contains(where: { name.hasPrefix("\($0)__") }) {
            try? fileManager.removeItem(at: folder.appendingPathComponent(name))
        }
    }

    /// Drops everything cached for every user, as on sign-out.
    func clear() {
        try? fileManager.removeItem(at: directory)
    }

    private func file(_ key: QueryKey, user: String) -> URL {
        directory.appendingPathComponent(user, isDirectory: true)
            .appendingPathComponent(key.fileName)
    }
}
