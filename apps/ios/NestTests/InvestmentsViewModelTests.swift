import Foundation
import Testing

@testable import Nest

private enum Investments {
    static let tradeJSON = """
        [{"id":"t1","household_id":"h","member_id":"m1","ticker":"VAS","side":"buy",\
        "traded_on":"2024-01-10","units":10,"price_per_unit_microdollars":90000000,\
        "fee_cents":950,"source":"manual","external_id":null,"document_id":"d1",\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let memberJSON = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let documentJSON = """
        [{"id":"d1","household_id":"h","storage_path":"h/d1/note.pdf",\
        "created_at":"2026-01-01T00:00:00Z"}]
        """
    static let portfolio = Portfolio(
        members: [Portfolio.Member(memberId: "m1", holdings: [], gainsByYear: [], unmatchedSales: [])],
        tradeValues: [Portfolio.TradeValue(tradeId: "t1", valueCents: 90_000)])
}

@MainActor
@Suite struct InvestmentsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "trade": Investments.tradeJSON, "members": Investments.memberJSON,
            "trade_document": Investments.documentJSON,
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
            .appendingPathComponent("InvestmentsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> InvestmentsViewModel {
        InvestmentsViewModel(
            data: data, derive: { _ in Investments.portfolio },
            figures: { _ in TradeFigures(units: 1, priceMicrodollars: 1_000_000, feeCents: 0) })
    }

    private let input = TradeInput(
        memberID: "m1", ticker: "VAS", side: .buy, tradedOn: "2024-01-10", units: 1.5,
        priceMicrodollars: 33_083_072, feeCents: 950)

    @Test func loadsTradesMembersAndTheirPortfolio() async {
        let model = model(makeData(Server(), directory: directory()))
        await model.load()
        let content = model.state.value
        #expect(content?.rows.trades.map(\.ticker) == ["VAS"])
        #expect(content?.rows.members.map(\.name) == ["Alex"])
        #expect(content?.rows.householdID == "h")
        #expect(content?.portfolio == Investments.portfolio)
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
        server.failing = ["trade"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.rows.trades.map(\.ticker) == ["VAS"])
        #expect(error?.code == .server)
    }

    @Test func addingInsertsIntoTheHouseholdThenReloads() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        try await model.save(input)
        let post = try #require(server.requests.first { $0.method == "POST" })
        #expect(post.table == "trade")
        #expect(post.body.contains("\"household_id\":\"h\""))
        #expect(post.body.contains("\"price_per_unit_microdollars\":33083072"))
        #expect(server.requests.last?.method == "GET")
    }

    @Test func editingPatchesTheRow() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        try await model.save(input, id: "t1")
        let patch = try #require(server.requests.first { $0.method == "PATCH" })
        #expect(patch.body.contains("\"fee_cents\":950") && patch.body.contains("\"member_id\":\"m1\""))
    }

    @Test func deletingRemovesTheRow() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        try await model.remove(id: "t1")
        #expect(server.requests.contains { $0.method == "DELETE" && $0.table == "trade" })
    }

    @Test func aFailedSaveThrows() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        server.failing = ["trade"]
        await #expect(throws: NestError.self) { try await model.save(input, id: "t1") }
    }
}
