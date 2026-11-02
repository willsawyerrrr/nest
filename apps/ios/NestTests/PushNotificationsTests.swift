import Foundation
import Testing

@testable import Nest

@Suite struct PushNotificationsTests {
    private static let base = URL(string: "https://nest.willsawyerrrr.dev")!

    private final class RequestBox: @unchecked Sendable {
        var requests: [URLRequest] = []
    }

    private func respond(_ status: Int, to request: URLRequest) -> (Data, URLResponse) {
        (
            Data(),
            HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        )
    }

    // MARK: Token and route

    @Test func hexEncodesTokenBytesInLowercase() {
        #expect(DeviceToken.hex(Data([0x00, 0xAB, 0x0F, 0xFF])) == "00ab0fff")
    }

    @Test func opensAPathWithinTheWebApp() {
        let url = NotificationRoute.url(from: ["url": "/gifts?x=1"], base: Self.base)
        #expect(url == URL(string: "https://nest.willsawyerrrr.dev/gifts?x=1"))
    }

    @Test(arguments: [
        "https://evil.example/gifts", "//evil.example/gifts", "gifts", "", "javascript:alert(1)",
    ])
    func ignoresAnythingButAnInAppPath(_ value: String) {
        #expect(NotificationRoute.url(from: ["url": value], base: Self.base) == nil)
    }

    @Test func ignoresAPayloadWithoutAURL() {
        #expect(NotificationRoute.url(from: ["aps": [:]], base: Self.base) == nil)
        #expect(NotificationRoute.url(from: ["url": 3], base: Self.base) == nil)
    }

    // MARK: Router

    @MainActor @Test func holdsAPageUntilTheWebViewTakesIt() {
        let router = NotificationRouter()
        let url = URL(string: "https://nest.willsawyerrrr.dev/gifts")!

        router.open(url)

        #expect(router.take() == url)
        #expect(router.take() == nil)
    }

    @MainActor @Test func handsAPageStraightToAShowingWebView() {
        let router = NotificationRouter()
        var opened: [URL] = []
        router.handler = { opened.append($0) }
        let url = URL(string: "https://nest.willsawyerrrr.dev/gifts")!

        router.open(url)

        #expect(opened == [url])
        #expect(router.take() == nil)
    }

    // MARK: Service

    @Test func registersTheTokenThroughTheRegisterFunction() async throws {
        let box = RequestBox()
        let service = PushDeviceService { request in
            box.requests.append(request)
            return self.respond(204, to: request)
        }

        try await service.register(token: "abc", environment: .sandbox, accessToken: "the-token")

        let request = try #require(box.requests.first)
        #expect(
            request.url
                == SupabaseConfig.url.appendingPathComponent("rest/v1/rpc/register_apns_device")
        )
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer the-token")
        #expect(request.value(forHTTPHeaderField: "apikey") == SupabaseConfig.anonKey)
        let data = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(body == ["p_token": "abc", "p_environment": "sandbox"])
    }

    @Test func unregistersOnlyTheTokenItNames() async throws {
        let box = RequestBox()
        let service = PushDeviceService { request in
            box.requests.append(request)
            return self.respond(204, to: request)
        }

        try await service.unregister(token: "abc", accessToken: "the-token")

        let request = try #require(box.requests.first)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.path.hasSuffix("/rest/v1/apns_device") == true)
        #expect(request.url?.query == "token=eq.abc")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer the-token")
    }

    @Test func throwsHTTPForANon2xxStatus() async {
        let service = PushDeviceService { self.respond(401, to: $0) }

        await #expect(throws: PushDeviceServiceError.self) {
            try await service.register(token: "abc", environment: .production, accessToken: "t")
        }
    }

    // MARK: Registrar

    private func registrar(
        _ box: RequestBox, status: Int = 204, accessToken: @escaping @Sendable () async throws -> String = { "t" }
    ) -> PushRegistrar {
        PushRegistrar(
            service: PushDeviceService { request in
                box.requests.append(request)
                return self.respond(status, to: request)
            },
            environment: .production,
            accessToken: accessToken
        )
    }

    private struct NoSession: Error {}

    @Test func registersOnceTheTokenArrives() async {
        let box = RequestBox()
        let registrar = registrar(box)

        await registrar.didReceive(token: "abc")
        await registrar.sync()

        #expect(box.requests.count == 1)
    }

    @Test func waitsForASessionBeforeRegistering() async {
        let box = RequestBox()
        let registrar = registrar(box, accessToken: { throw NoSession() })

        await registrar.didReceive(token: "abc")

        #expect(box.requests.isEmpty)
    }

    @Test func retriesAfterAFailedRegistration() async {
        let box = RequestBox()
        let registrar = registrar(box, status: 500)

        await registrar.didReceive(token: "abc")
        await registrar.sync()

        #expect(box.requests.count == 2)
    }

    @Test func registersAgainAfterUnregistering() async {
        let box = RequestBox()
        let registrar = registrar(box)

        await registrar.didReceive(token: "abc")
        await registrar.unregister()
        await registrar.sync()

        #expect(box.requests.map(\.httpMethod) == ["POST", "DELETE", "POST"])
    }

    @Test func unregisteringWithoutATokenDoesNothing() async {
        let box = RequestBox()

        await registrar(box).unregister()

        #expect(box.requests.isEmpty)
    }
}
