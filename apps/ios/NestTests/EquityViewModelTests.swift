import Foundation
import Testing

@testable import Nest

private enum EquityFixture {
    static let figures = [
        GrantFigures(
            grantId: "g1", vested: 500, exercised: 100, sold: 40, held: 60, grossCents: 1_000_00,
            exerciseCents: 200_00, netCents: 800_00)
    ]

    static let grantJSON = """
        [{"id":"g1","household_id":"h","member_id":"m1","label":"Acme options",\
        "instrument_type":"option","quantity":1000,"grant_date":"2025-01-01","cliff_months":12,\
        "vesting_period_months":48,"vesting_frequency":"monthly","strike_price_cents":50,\
        "price_per_share_cents":250,"price_as_of":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let exerciseJSON = """
        [{"id":"e1","household_id":"h","member_id":"m1","grant_id":"g1","exercised_on":"2025-09-30",\
        "quantity":100,"strike_price_cents":50,"market_price_per_share_cents":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let saleJSON = """
        [{"id":"s1","household_id":"h","member_id":"m1","grant_id":"g1","sold_on":"2026-05-01",\
        "quantity":40,"price_per_share_cents":250,"fee_cents":0,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let memberJSON = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Ada","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
}

@MainActor
@Suite struct EquityViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "equity_grant": EquityFixture.grantJSON, "equity_exercise": EquityFixture.exerciseJSON,
            "equity_sale": EquityFixture.saleJSON, "members": EquityFixture.memberJSON,
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [String] = []
        var paths: [String] { lock.withLock { recorded } }
        func record(_ path: String) { lock.withLock { recorded.append(path) } }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(table)
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
            .appendingPathComponent("EquityViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> EquityViewModel {
        EquityViewModel(data: data, summarise: { _ in EquityFixture.figures })
    }

    @Test func loadsEveryTableThenShowsTheFigures() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.figures == EquityFixture.figures)
        #expect(model.state.value?.rows.grants.map(\.label) == ["Acme options"])
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(
            Set(server.paths) == ["equity_grant", "equity_exercise", "equity_sale", "members"])
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["equity_sale"]
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
        server.failing = ["equity_grant"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.figures == EquityFixture.figures)
        #expect(error?.code == .server)
    }
}

@Suite struct EquityPresentationTests {
    private func content() throws -> EquityContent {
        func rows<T: Decodable>(_ json: String) throws -> [T] {
            try JSONDecoder().decode([T].self, from: Data(json.utf8))
        }
        return EquityContent(
            rows: EquityRows(
                grants: try rows(EquityFixture.grantJSON),
                exercises: try rows(EquityFixture.exerciseJSON),
                sales: try rows(EquityFixture.saleJSON),
                members: try rows(EquityFixture.memberJSON)),
            figures: EquityFixture.figures)
    }

    @Test func labelsAGrantFromItsFigures() throws {
        let grant = try #require(EquityPresentation(content: content()).members.first?.grants.first)
        #expect(grant.instrumentLabel == "Options" && grant.frequencyLabel == "Monthly")
        #expect(grant.vestedLabel == "500 / 1,000 vested")
        #expect(grant.valueLine == "Vested value $1,000.00 · Exercise cost $200.00")
        #expect(grant.activityLine == "100 exercised · 40 sold · 60 shares held")
        #expect(
            grant.caption
                == "Vested value $1,000.00 · Exercise cost $200.00 — 100 exercised · 40 sold · 60 shares held"
        )
    }

    @Test func listsExercisesAndSalesWithTheirGrant() throws {
        let member = try #require(EquityPresentation(content: content()).members.first)
        #expect(member.exercises?.first?.title == "100 × Acme options")
        #expect(member.exercises?.first?.detail == "30 Sept 2025 · strike $0.50")
        #expect(member.sales?.first?.detail == "1 May 2026 · $2.50 per share")
    }

    @Test func aMemberWithNoGrantsHasNoExerciseOrSaleSection() throws {
        var rows = try content().rows
        rows.grants = []
        let member = try #require(
            EquityPresentation(content: EquityContent(rows: rows, figures: [])).members.first)
        #expect(member.grants.isEmpty && member.exercises == nil && member.sales == nil)
    }

    @Test func activityNamesOnlyWhatMoved() {
        #expect(EquityPresentation.activity(exercised: 0, sold: 0, held: 5) == nil)
        #expect(
            EquityPresentation.activity(exercised: 0, sold: 3, held: 7) == "3 sold · 7 shares held")
    }
}
