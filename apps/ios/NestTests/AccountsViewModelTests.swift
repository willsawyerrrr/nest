import Foundation
import Testing

@testable import Nest

private enum Fixture {
    static let accountJSON = """
        [{"id":"a1","household_id":"h","name":"Bills","type":"savings","source":"up",\
        "balance_cents":100,"owner_member_id":null,"exclude_from_net_worth":false,\
        "deleted_from_source_at":null,"external_id":"up-a1","currency":"AUD",\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let memberJSON = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
}

@MainActor
@Suite struct AccountsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "accounts_with_balance": Fixture.accountJSON, "members": Fixture.memberJSON,
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(method: String, table: String, body: String)] = []
        var requests: [(method: String, table: String, body: String)] { lock.withLock { recorded } }
        func record(_ method: String, _ table: String, _ body: Data?) {
            lock.withLock {
                recorded.append((method, table, body.flatMap { String(data: $0, encoding: .utf8) } ?? ""))
            }
        }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(request.httpMethod ?? "", table, request.httpBody)
                    let failed = server.failing.contains(table)
                    return (
                        Data((failed ? "{}" : server.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("AccountsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> AccountsViewModel {
        AccountsViewModel(data: data)
    }

    @Test func loadsAccountsAndMembers() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.accounts.map(\.name) == ["Bills"])
        #expect(model.state.value?.members.map(\.name) == ["Alex"])
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["members"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedRows() async {
        let server = Server()
        let dir = directory()
        await model(makeData(server, directory: dir)).load()
        server.failing = ["accounts_with_balance"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let rows, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(rows.accounts.map(\.name) == ["Bills"])
        #expect(error?.code == .server)
    }
}
