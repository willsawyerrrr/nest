import Foundation
import Testing

@testable import Nest

private enum Household {
    private final class BundleLocator {}

    struct Fixture: Decodable {
        var rows: PayslipsRows
        var expected: PayslipsOverview
    }

    static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "payslips-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))[0]
    }()

    /// Each table's rows as PostgREST would return them.
    static var bodies: [String: String] {
        func json<T: Encodable>(_ rows: [T]) -> String {
            String(decoding: try! JSONEncoder().encode(rows), as: UTF8.self)
        }
        let rows = fixture.rows
        return [
            "members": json(rows.members), "inflows": json(rows.inflows),
            "tax_profile": json(rows.taxProfiles), "super_contribution": json(rows.contributions),
            "help_debt": json(rows.helpDebts), "deduction": json(rows.deductions),
            "payslip": json(rows.payslips), "payslip_line": json(rows.lines),
        ]
    }
}

private final class StubService: PayslipsServicing, @unchecked Sendable {
    private let lock = NSLock()
    private var saved: [PayslipSubmission] = []
    private var deleted: [String] = []
    var failing = false
    var submissions: [PayslipSubmission] { lock.withLock { saved } }
    var deletions: [String] { lock.withLock { deleted } }

    func upload(household: String, payslipId: String, file: UploadRules.PreparedFile) async throws -> String { "p" }
    func discard(path: String) async {}
    func read(path: String, financialYear: Int) async -> ExtractionOutcome { .failed(message: "x") }
    func save(_ submission: PayslipSubmission, household: String, superseding: String?) async throws {
        if failing { throw NestError(.server) }
        lock.withLock { saved.append(submission) }
    }
    func delete(_ payslip: Payslip) async throws { lock.withLock { deleted.append(payslip.id) } }
    func signedURL(path: String) async -> URL? { nil }
}

@MainActor
@Suite struct PayslipsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies = Household.bodies
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(table: String, query: String)] = []
        var requests: [(table: String, query: String)] { lock.withLock { recorded } }
        func record(_ table: String, _ query: String) { lock.withLock { recorded.append((table, query)) } }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(table, request.url!.query ?? "")
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
            .appendingPathComponent("PayslipsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(
        _ data: NestData, service: StubService = StubService()
    ) -> PayslipsViewModel {
        PayslipsViewModel(
            data: data, service: service, measure: { _ in Household.fixture.expected },
            now: { ISO8601DateFormatter().date(from: "2026-12-01T00:00:00Z")! })
    }

    @Test func loadsEveryTableScopedToTheYearThenShowsTheOverview() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.overview == Household.fixture.expected)
        #expect(model.state.value?.financialYear == 2027)
        #expect(model.state.value?.rows.payslips.count == Household.fixture.rows.payslips.count)
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        let requests = server.requests
        #expect(Set(requests.map(\.table)) == Set(Household.bodies.keys))
        for table in ["payslip", "tax_profile", "super_contribution", "deduction"] {
            #expect(requests.first { $0.table == table }?.query.contains("financial_year=eq.2027") == true)
        }
        #expect(requests.first { $0.table == "payslip" }?.query.contains("order=period_end.desc") == true)
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["payslip_line"]
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
        server.failing = ["payslip"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.overview == Household.fixture.expected)
        #expect(error?.code == .server)
    }

    @Test func savingWritesThroughTheServiceThenReloads() async throws {
        let server = Server()
        let service = StubService()
        let model = model(makeData(server, directory: directory()), service: service)
        await model.load()
        let before = server.requests.count
        let draft = PayslipDraft(today: "2026-12-01")
        draft.prefill(
            PayslipExtraction(model: "m", amounts: [.gross: 1, .taxWithheld: 1, .super: 1, .net: 1]),
            options: [])
        let submission = try #require(draft.submission(id: "new", memberID: "m1", attachment: nil))
        try await model.save(submission)
        #expect(service.submissions.map(\.id) == ["new"])
        #expect(server.requests.count > before)
    }

    @Test func aFailedSaveThrowsTheErrorAndKeepsTheScreen() async throws {
        let server = Server()
        let service = StubService()
        service.failing = true
        let model = model(makeData(server, directory: directory()), service: service)
        await model.load()
        let draft = PayslipDraft(today: "2026-12-01")
        let submission = try #require(draft.submission(id: "new", memberID: "m1", attachment: nil))
        await #expect(throws: NestError.self) { try await model.save(submission) }
        #expect(model.state.value != nil)
    }

    @Test func deletingRemovesThePayslipThenReloads() async throws {
        let server = Server()
        let service = StubService()
        let model = model(makeData(server, directory: directory()), service: service)
        await model.load()
        let payslip = try #require(model.state.value?.rows.payslips.first)
        try await model.delete(payslip)
        #expect(service.deletions == [payslip.id])
    }
}
