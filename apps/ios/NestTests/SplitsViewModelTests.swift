import Foundation
import Testing

@testable import Nest

private enum SplitsFixtures {
    static let routes = PaySplitRoutes(
        accounts: [
            .init(
                accountId: "a1", fortnightlyCents: 396_00,
                lines: [.init(id: "b1", name: "Rent", fortnightlyCents: 396_00)])
        ], unassignedFortnightlyCents: 0)
}

@MainActor
@Suite struct SplitsViewModelTests {
    private struct Request: Sendable, Equatable {
        let method: String
        let path: String
        let query: String
        let body: String
    }

    private final class Server: @unchecked Sendable {
        private let lock = NSLock()
        var bodies: [String: String] = [:]
        var failing: Set<String> = []
        private var recorded: [Request] = []
        var requests: [Request] { lock.withLock { recorded } }
        func record(_ request: Request) { lock.withLock { recorded.append(request) } }
        func writes() -> [Request] { requests.filter { $0.method != "GET" } }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let name = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(
                        Request(
                            method: request.httpMethod ?? "",
                            path: request.url!.path,
                            query: request.url!.query ?? "",
                            body: String(decoding: request.httpBody ?? Data(), as: UTF8.self)))
                    let failed = server.failing.contains(name)
                    return (
                        Data((failed ? "{}" : server.bodies[name] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u-m1" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("SplitsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> SplitsViewModel {
        SplitsViewModel(
            data: data, route: { _ in SplitsFixtures.routes },
            now: { Date(timeIntervalSince1970: 1_796_083_200) })
    }

    private let member = """
        [{"household_id":"h","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z",\
        "id":"m1","name":"Ada","date_of_birth":null,"email":null,"up_connected_at":null,\
        "up_sync_failed_at":null,"user_id":"u-m1"}]
        """

    private let household = """
        [{"id":"h","name":"Home","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z",\
        "invite_code":null,"invite_code_expires_at":null,"pay_account_id":"a2","timezone":"UTC"}]
        """

    @Test func loadsEveryTableThenShowsTheRoutes() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.routes == SplitsFixtures.routes)
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(
            Set(server.requests.map { $0.path.split(separator: "/").last.map(String.init) ?? "" })
                == [
                    "budget_line", "savings_goal", "account_directory", "super_profile",
                    "pay_split", "households", "members", "member_allowance",
                ])
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["pay_split"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedRoutes() async {
        let server = Server()
        let dir = directory()
        await model(makeData(server, directory: dir)).load()
        server.failing = ["pay_split"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.routes == SplitsFixtures.routes)
        #expect(error?.code == .server)
    }

    @Test func confirmingUpsertsTheRoundedSplitForTheAccount() async throws {
        let server = Server()
        server.bodies["members"] = member
        server.bodies["households"] = household
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.confirm(accountID: "a1", fortnightlyCents: 400_00)
        let write = try #require(server.writes().first)
        #expect(write.method == "POST" && write.path.hasSuffix("/rest/v1/pay_split"))
        #expect(write.query == "on_conflict=household_id,account_id")
        let body = try #require(
            JSONSerialization.jsonObject(with: Data(write.body.utf8)) as? [String: Any])
        #expect(body["household_id"] as? String == "h")
        #expect(body["account_id"] as? String == "a1")
        #expect(body["confirmed_fortnightly_cents"] as? Int == 400_00)
        #expect(model.actionError == nil)
    }

    @Test func clearingDeletesTheAccountsSplit() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.clear(accountID: "a1")
        let write = try #require(server.writes().first)
        #expect(write.method == "DELETE" && write.path.hasSuffix("/rest/v1/pay_split"))
        #expect(write.query == "account_id=eq.a1")
    }

    @Test func settingThePayAccountCallsTheRPCAndClearingSendsNull() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.setPayAccount("a2")
        await model.setPayAccount(nil)
        let writes = server.writes()
        #expect(
            writes.map(\.path).allSatisfy { $0.hasSuffix("/rest/v1/rpc/set_household_pay_account") })
        #expect(writes.map(\.body) == [#"{"p_account_id":"a2"}"#, #"{"p_account_id":null}"#])
    }

    @Test func aFailedWriteSurfacesAFixedMessageAndKeepsTheScreen() async {
        let server = Server()
        server.failing = ["set_household_pay_account"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.setPayAccount("a2")
        #expect(model.actionError?.code == .server)
        #expect(model.state.value?.routes == SplitsFixtures.routes)
    }
}
