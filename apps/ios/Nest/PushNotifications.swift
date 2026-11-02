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

enum NotificationRoute {
    /// The page a notification opens, from the `url` its payload carries.
    ///
    /// Only a path within the web app is honoured, so a payload can never send
    /// the web view off-site; anything else yields nil.
    static func url(from userInfo: [AnyHashable: Any], base: URL) -> URL? {
        guard let path = userInfo["url"] as? String,
            path.hasPrefix("/"), !path.hasPrefix("//"),
            let url = URL(string: path, relativeTo: base)?.absoluteURL,
            url.host == base.host
        else { return nil }
        return url
    }
}

/// Holds the page a tapped notification asked for until the web view can open
/// it, and hands it over directly once one is showing.
@MainActor
final class NotificationRouter {
    static let shared = NotificationRouter()

    private(set) var pending: URL?

    /// Set by the web view while it is showing.
    var handler: ((URL) -> Void)?

    func open(_ url: URL) {
        if let handler {
            handler(url)
        } else {
            pending = url
        }
    }

    func take() -> URL? {
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
