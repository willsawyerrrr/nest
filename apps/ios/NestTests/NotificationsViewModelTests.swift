import Foundation
import Testing

@testable import Nest

private enum Notifications {
    static let preferenceJSON = """
        [{"id":"p1","household_id":"h","member_id":"m1","trigger":"fy_boundary","enabled":false,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let memberJSON = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
}

@MainActor
@Suite struct NotificationsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "notification_preference": Notifications.preferenceJSON,
            "members": Notifications.memberJSON,
            "push-test": #"{"devices":1,"sent":1,"pruned":0,"failed":0}"#,
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(method: String, name: String, query: String, body: String)] = []
        var requests: [(method: String, name: String, query: String, body: String)] {
            lock.withLock { recorded }
        }
        func record(_ request: URLRequest) {
            lock.withLock {
                recorded.append(
                    (
                        request.httpMethod ?? "", request.url!.path.split(separator: "/").last.map(String.init) ?? "",
                        request.url!.query ?? "",
                        request.httpBody.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                    ))
            }
        }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let name = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(request)
                    let failed = server.failing.contains(name)
                    return (
                        Data((failed ? "{}" : server.bodies[name] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("NotificationsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    @Test func loadsPreferencesAndMembers() async {
        let model = NotificationsViewModel(data: makeData(Server(), directory: directory()))
        await model.load()
        #expect(model.state.value?.preferences.map(\.trigger) == [.fyBoundary])
        #expect(model.state.value?.members.map(\.name) == ["Alex"])
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["members"]
        let model = NotificationsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        guard case .failed = model.state else {
            Issue.record("not failed")
            return
        }
    }

    @Test func aFailedRefreshKeepsTheCache() async {
        let server = Server()
        let dir = directory()
        await NotificationsViewModel(data: makeData(server, directory: dir)).load()
        server.failing = ["members"]
        let model = NotificationsViewModel(data: makeData(server, directory: dir))
        await model.load()
        guard case .loaded(let rows, _, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(rows.preferences.map(\.trigger) == [.fyBoundary])
        #expect(error != nil)
    }

    @Test func togglingUpsertsTheMembersChoice() async throws {
        let server = Server()
        let model = NotificationsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        try await model.setEnabled(.bufferNegative, false)
        let write = try #require(server.requests.first { $0.method == "POST" && $0.name == "notification_preference" })
        #expect(write.query == "on_conflict=member_id,trigger")
        let body = try #require(
            JSONSerialization.jsonObject(with: Data(write.body.utf8)) as? [String: Any])
        #expect(body["household_id"] as? String == "h")
        #expect(body["member_id"] as? String == "m1")
        #expect(body["trigger"] as? String == "buffer_negative")
        #expect(body["enabled"] as? Bool == false)
        #expect(model.pending.isEmpty)
    }

    @Test func aFailedToggleThrowsAndLeavesNothingPending() async {
        let server = Server()
        let model = NotificationsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        server.failing = ["notification_preference"]
        await #expect(throws: (any Error).self) { try await model.setEnabled(.bufferNegative, false) }
        #expect(model.pending.isEmpty)
    }

    @Test func aTestSendReportsItsResult() async {
        let server = Server()
        let model = NotificationsViewModel(data: makeData(server, directory: directory()))
        await model.sendTest()
        #expect(model.test == .sent("Sent to 1 device."))
        #expect(server.requests.contains { $0.method == "POST" && $0.name == "push-test" })
    }

    @Test func aFailedTestSendReportsFixedCopy() async {
        let server = Server()
        server.failing = ["push-test"]
        let model = NotificationsViewModel(data: makeData(server, directory: directory()))
        await model.sendTest()
        #expect(model.test == .failed(NotificationsPresentation.testFailed))
    }
}
