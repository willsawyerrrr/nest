import Foundation
import Testing

@testable import Nest

@MainActor
@Suite struct HouseholdViewModelTests {
    nonisolated private static let householdJSON = """
        [{"id":"h","name":"Home","invite_code":"ABC123","invite_code_expires_at":"2099-01-01T00:00:00Z",\
        "pay_account_id":null,"timezone":"Australia/Sydney",\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """

    private final class Server: @unchecked Sendable {
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(method: String, table: String)] = []
        var requests: [(method: String, table: String)] { lock.withLock { recorded } }
        func record(_ method: String, _ table: String) {
            lock.withLock { recorded.append((method, table)) }
        }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(request.httpMethod ?? "", table)
                    let failed = server.failing.contains(table)
                    let body = table == "households" ? Self.householdJSON : "null"
                    return (
                        Data((failed ? "{}" : body).utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("HouseholdViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData, signOut: @escaping @Sendable () async -> Void = {})
        -> HouseholdViewModel
    {
        HouseholdViewModel(data: data, currentEmail: { "a@b.co" }, signOut: signOut)
    }

    @Test func loadsTheHouseholdAndEmail() async {
        let model = model(makeData(Server(), directory: directory()))
        await model.load()
        #expect(model.state.value?.household?.name == "Home")
        #expect(model.state.value?.household?.inviteCode == "ABC123")
        #expect(model.email == "a@b.co")
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["households"]
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
        server.failing = ["households"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let rows, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(rows.household?.name == "Home")
        #expect(error?.code == .server)
    }

    @Test func creatingAndRevokingCallTheRPCsThenReload() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        try await model.createInviteCode()
        try await model.revokeInviteCode()
        let calls = server.requests.filter { $0.method == "POST" }.map(\.table)
        #expect(calls == ["create_invite_code", "revoke_invite_code"])
        #expect(server.requests.last?.method == "GET")
    }

    @Test func aFailedCallThrows() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        server.failing = ["create_invite_code"]
        await #expect(throws: NestError.self) { try await model.createInviteCode() }
    }

    @Test func signOutRunsTheAction() async {
        final class Flag: @unchecked Sendable { var set = false }
        let flag = Flag()
        let model = model(makeData(Server(), directory: directory()), signOut: { flag.set = true })
        await model.signOut()
        #expect(flag.set)
    }
}
