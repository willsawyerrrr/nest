import Foundation

/// Which APNs host a device token belongs to. A build signed for development
/// is issued sandbox tokens that the production host rejects; TestFlight and
/// App Store builds are issued production tokens.
enum PushEnvironment: String, Sendable {
    case sandbox
    case production

    static var current: PushEnvironment {
        #if DEBUG
        .sandbox
        #else
        .production
        #endif
    }
}

enum DeviceToken {
    /// The lowercase hex form of the token bytes APNs expects in a request path.
    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

/// The native screen a notification opens, with any context that screen takes.
struct NotificationDestination: Equatable, Sendable {
    var route: Route
    /// A wishlist item to promote, prefilling the Goals or Budget add form.
    var draft: PromoteDraft?
    /// The record the screen focuses: a transaction to review.
    var id: String?

    /// The routes that focus a record named by an `id` query item.
    private static let idRoutes: Set<Route> = [.transactionReview]

    /// Paths the web app redirects to a route, which notifications may carry.
    private static let aliases: [String: Route] = ["/": .summary, "/household": .household]

    /// The destination for the in-app path in a payload's `url`, optionally with
    /// a query; nil for anything outside the app or naming no route.
    ///
    /// A `promoteName` and positive integer `promoteAmountCents` in the query
    /// carry a promote draft to Goals or Budget, and a non-empty `id` names the
    /// record a route focuses, as they do for the web app.
    init?(userInfo: [AnyHashable: Any]) {
        guard let value = userInfo["url"] as? String,
            value.hasPrefix("/"), !value.hasPrefix("//"),
            let components = URLComponents(string: value),
            components.scheme == nil, components.host == nil
        else { return nil }
        let path = components.path.count > 1 && components.path.hasSuffix("/")
            ? String(components.path.dropLast()) : components.path
        guard let route = Route(rawValue: path) ?? Self.aliases[path] else { return nil }
        self.route = route
        let items = components.queryItems ?? []
        draft = [.goals, .budget].contains(route) ? Self.draft(from: items) : nil
        id = Self.idRoutes.contains(route)
            ? items.first { $0.name == "id" }?.value.flatMap { $0.isEmpty ? nil : $0 } : nil
    }

    init(route: Route, draft: PromoteDraft? = nil, id: String? = nil) {
        self.route = route
        self.draft = draft
        self.id = id
    }

    private static func draft(from items: [URLQueryItem]) -> PromoteDraft? {
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let name = value("promoteName"), !name.isEmpty,
            let amount = value("promoteAmountCents").flatMap(Int.init), amount > 0
        else { return nil }
        return PromoteDraft(name: name, amountCents: amount)
    }
}

/// Holds the destination a tapped notification asked for until the navigation
/// shell opens it: at once while the shell is showing, or once it appears after
/// launch or sign-in.
@MainActor @Observable
final class NotificationRouter {
    static let shared = NotificationRouter()

    private(set) var pending: NotificationDestination?

    func open(_ destination: NotificationDestination) {
        pending = destination
    }

    func take() -> NotificationDestination? {
        defer { pending = nil }
        return pending
    }
}

enum PushDeviceServiceError: Error {
    case http(status: Int)
}

/// Registers this install's APNs token with the signed-in member, through
/// PostgREST with the caller's access token. The transport is injected so tests
/// can stub the network.
struct PushDeviceService: Sendable {
    var send: @Sendable (_ request: URLRequest) async throws -> (Data, URLResponse)

    static let live = PushDeviceService { try await URLSession.shared.data(for: $0) }

    /// `register_apns_device` stores the token for the caller, taking it over
    /// from whichever member it was last registered to.
    func register(token: String, environment: PushEnvironment, accessToken: String) async throws {
        var request = authorised(
            SupabaseConfig.url.appendingPathComponent("rest/v1/rpc/register_apns_device"),
            accessToken: accessToken
        )
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(
            withJSONObject: ["p_token": token, "p_environment": environment.rawValue]
        )
        try await perform(request)
    }

    /// Removes the token from the caller's own devices, so a signed-out install
    /// stops receiving the member's notifications.
    func unregister(token: String, accessToken: String) async throws {
        var components = URLComponents(
            url: SupabaseConfig.url.appendingPathComponent("rest/v1/apns_device"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "token", value: "eq.\(token)")]
        var request = authorised(components.url!, accessToken: accessToken)
        request.httpMethod = "DELETE"
        try await perform(request)
    }

    private func authorised(_ url: URL, accessToken: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func perform(_ request: URLRequest) async throws {
        let (_, response) = try await send(request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw PushDeviceServiceError.http(status: http.statusCode)
        }
    }
}

/// Keeps this install's APNs token registered with the signed-in member.
///
/// The token arrives from the system independently of the session, so
/// registration waits for both and is retried whenever either appears.
actor PushRegistrar {
    static let shared = PushRegistrar()

    private let service: PushDeviceService
    private let environment: PushEnvironment
    private let accessToken: @Sendable () async throws -> String
    private var token: String?
    private var registered = false

    init(
        service: PushDeviceService = .live,
        environment: PushEnvironment = .current,
        accessToken: @escaping @Sendable () async throws -> String = {
            try await supabaseAuth.session.accessToken
        }
    ) {
        self.service = service
        self.environment = environment
        self.accessToken = accessToken
    }

    func didReceive(token: String) async {
        if self.token != token { registered = false }
        self.token = token
        await sync()
    }

    /// Registers the token if there is both a token and a session and it has not
    /// been registered yet. A failure leaves it unregistered for the next call.
    func sync() async {
        guard !registered, let token, let accessToken = try? await accessToken() else { return }
        do {
            try await service.register(token: token, environment: environment, accessToken: accessToken)
            registered = true
        } catch {}
    }

    /// Run before sign-out, while the session can still authorise the delete.
    func unregister() async {
        guard let token, let accessToken = try? await accessToken() else { return }
        try? await service.unregister(token: token, accessToken: accessToken)
        registered = false
    }
}
