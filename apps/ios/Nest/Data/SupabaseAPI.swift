import Foundation

/// A PostgREST filter, rendered as `column=op.value`.
struct Filter: Equatable, Sendable {
    let column: String
    let op: String
    let value: String

    static func eq(_ column: String, _ value: String) -> Filter {
        .init(column: column, op: "eq", value: value)
    }
    static func neq(_ column: String, _ value: String) -> Filter {
        .init(column: column, op: "neq", value: value)
    }
    static func gte(_ column: String, _ value: String) -> Filter {
        .init(column: column, op: "gte", value: value)
    }
    static func lte(_ column: String, _ value: String) -> Filter {
        .init(column: column, op: "lte", value: value)
    }
    static func `in`(_ column: String, _ values: [String]) -> Filter {
        .init(column: column, op: "in", value: "(\(values.joined(separator: ",")))")
    }
    static func isNull(_ column: String) -> Filter {
        .init(column: column, op: "is", value: "null")
    }
}

/// Sort for a select: `order=column.asc|desc`.
struct Order: Equatable, Sendable {
    let column: String
    var ascending = true
}

/// Typed access to the household's Supabase project with the signed-in user's
/// access token: PostgREST (select/insert/update/delete/RPC), Storage signed
/// URLs and edge functions. Plain `URLRequest`s over an injected transport, so
/// tests stub the network. Every failure is thrown as a `NestError`.
struct SupabaseAPI: Sendable {
    typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    var baseURL: URL
    var anonKey: String
    var accessToken: @Sendable () async throws -> String
    var send: Transport

    static let live = SupabaseAPI(
        baseURL: SupabaseConfig.url,
        anonKey: SupabaseConfig.anonKey,
        accessToken: { try await supabaseAuth.session.accessToken },
        send: { try await URLSession.shared.data(for: $0) }
    )

    // MARK: PostgREST

    /// Rows of `T` matching `filters`, in `order`.
    func select<T: NestRow>(
        _: T.Type, filters: [Filter] = [], order: [Order] = [], limit: Int? = nil
    ) async throws -> [T] {
        var items = [URLQueryItem(name: "select", value: "*")]
        items += filters.map { URLQueryItem(name: $0.column, value: "\($0.op).\($0.value)") }
        if !order.isEmpty {
            let value = order.map { "\($0.column).\($0.ascending ? "asc" : "desc")" }.joined(
                separator: ",")
            items.append(URLQueryItem(name: "order", value: value))
        }
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        let data = try await request("GET", path: "rest/v1/\(T.table)", query: items)
        return try decode([T].self, from: data)
    }

    /// Inserts `values` and returns the stored rows.
    func insert<T: NestRow>(_: T.Type, values: some Encodable & Sendable) async throws -> [T] {
        let data = try await request(
            "POST", path: "rest/v1/\(T.table)", body: encode(values),
            headers: ["Prefer": "return=representation"]
        )
        return try decode([T].self, from: data)
    }

    /// Inserts `values`, or updates the row already holding the same `onConflict`
    /// columns, and returns the stored rows.
    func upsert<T: NestRow>(
        _: T.Type, values: some Encodable & Sendable, onConflict: String
    ) async throws -> [T] {
        let data = try await request(
            "POST", path: "rest/v1/\(T.table)",
            query: [URLQueryItem(name: "on_conflict", value: onConflict)], body: encode(values),
            headers: ["Prefer": "resolution=merge-duplicates,return=representation"]
        )
        return try decode([T].self, from: data)
    }

    /// Applies `values` to every row matching `filters` and returns the updated rows.
    func update<T: NestRow>(
        _: T.Type, values: some Encodable & Sendable, filters: [Filter]
    ) async throws -> [T] {
        let data = try await request(
            "PATCH", path: "rest/v1/\(T.table)", query: Self.items(filters),
            body: encode(values), headers: ["Prefer": "return=representation"]
        )
        return try decode([T].self, from: data)
    }

    /// Deletes every row matching `filters`. An empty filter list is refused so
    /// a bug cannot truncate a table.
    func delete<T: NestRow>(_: T.Type, filters: [Filter]) async throws {
        guard !filters.isEmpty else { throw NestError(.invalidRequest) }
        _ = try await request("DELETE", path: "rest/v1/\(T.table)", query: Self.items(filters))
    }

    /// Calls the Postgres function `name` with `params` and decodes its result.
    func rpc<R: Decodable>(
        _ name: String, params: some Encodable & Sendable = EmptyBody(), as _: R.Type = R.self
    ) async throws -> R {
        let data = try await request("POST", path: "rest/v1/rpc/\(name)", body: encode(params))
        return try decode(R.self, from: data)
    }

    /// Calls the Postgres function `name` for its side effect, ignoring any result.
    func call(_ name: String, params: some Encodable & Sendable = EmptyBody()) async throws {
        _ = try await request("POST", path: "rest/v1/rpc/\(name)", body: encode(params))
    }

    // MARK: Storage

    /// A time-limited download URL for `path` in the private `bucket`.
    func signedURL(bucket: String, path: String, expiresIn seconds: Int = 3600) async throws -> URL
    {
        struct Response: Decodable { let signedURL: String }
        let data = try await request(
            "POST", path: "storage/v1/object/sign/\(bucket)/\(path)",
            body: encode(["expiresIn": seconds])
        )
        let response = try decode(Response.self, from: data)
        let relative =
            response.signedURL.hasPrefix("/")
            ? String(response.signedURL.dropFirst()) : response.signedURL
        guard let url = URL(string: "storage/v1/\(relative)", relativeTo: baseURL)?.absoluteURL
        else {
            throw NestError(.decoding)
        }
        return url
    }

    /// Stores `data` at `path` in the private `bucket` as `contentType`.
    func upload(bucket: String, path: String, data: Data, contentType: String) async throws {
        _ = try await request(
            "POST", path: "storage/v1/object/\(bucket)/\(path)", body: data,
            headers: ["Content-Type": contentType])
    }

    /// Deletes the objects at `paths` in the private `bucket`.
    func remove(bucket: String, paths: [String]) async throws {
        _ = try await request(
            "DELETE", path: "storage/v1/object/\(bucket)", body: encode(["prefixes": paths]))
    }

    // MARK: Edge functions

    /// Calls the edge function `name` with `body` and decodes its JSON response.
    func invoke<R: Decodable>(
        _ name: String, body: some Encodable & Sendable = EmptyBody(), as _: R.Type = R.self
    ) async throws -> R {
        let data = try await request("POST", path: "functions/v1/\(name)", body: encode(body))
        return try decode(R.self, from: data)
    }

    /// Calls the edge function `name` with `body`, handing back the status and
    /// body of any response, so a caller can read a failure's own fields.
    func invokeRaw(
        _ name: String, body: some Encodable & Sendable = EmptyBody()
    ) async throws -> (status: Int, data: Data) {
        try await perform("POST", path: "functions/v1/\(name)", body: encode(body))
    }

    // MARK: Plumbing

    struct EmptyBody: Codable, Sendable {}

    /// A response whose content is not read.
    struct Ignored: Decodable, Sendable {
        init(from decoder: Decoder) throws {}
    }

    private static func items(_ filters: [Filter]) -> [URLQueryItem] {
        filters.map { URLQueryItem(name: $0.column, value: "\($0.op).\($0.value)") }
    }

    private func request(
        _ method: String, path: String, query: [URLQueryItem] = [], body: Data? = nil,
        headers: [String: String] = [:]
    ) async throws -> Data {
        let (status, data) = try await perform(
            method, path: path, query: query, body: body, headers: headers)
        if !(200..<300).contains(status) {
            throw NestError.response(status: status, body: data)
        }
        return data
    }

    /// Sends a request and returns whatever response came back, whatever its status.
    private func perform(
        _ method: String, path: String, query: [URLQueryItem] = [], body: Data? = nil,
        headers: [String: String] = [:]
    ) async throws -> (status: Int, data: Data) {
        let token: String
        do {
            token = try await accessToken()
        } catch {
            throw NestError(.unauthenticated)
        }

        var components = URLComponents(
            url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await send(request)
        } catch {
            throw NestError.from(error)
        }
        return ((response as? HTTPURLResponse)?.statusCode ?? 200, data)
    }

    private func encode(_ value: some Encodable) throws -> Data {
        do { return try JSONEncoder().encode(value) } catch { throw NestError(.invalidRequest) }
    }

    private func decode<R: Decodable>(_: R.Type, from data: Data) throws -> R {
        do { return try JSONDecoder().decode(R.self, from: data) } catch {
            throw NestError(.decoding)
        }
    }
}
