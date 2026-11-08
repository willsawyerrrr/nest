import Foundation
import Testing

@testable import Nest

private enum BudgetFixtures {
    static let overview = BudgetOverview(
        lines: [], groups: .init(needs: 1, wants: 2, discretionary: 3, savings: 4, investments: 5),
        allowances: [], temporaryActive: [])
}

@MainActor
@Suite struct BudgetViewModelTests {
    private final class Server: @unchecked Sendable {
        private let lock = NSLock()
        var bodies: [String: String] = [:]
        var failing: Set<String> = []
        private var recorded: [String] = []
        var paths: [String] { lock.withLock { recorded } }
        func record(_ path: String) { lock.withLock { recorded.append(path) } }
    }

    private func makeData(_ server: Server, directory: URL, user: String = "u-m1") -> NestData {
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
            cache: RowCache(directory: directory), userID: { user })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("BudgetViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> BudgetViewModel {
        BudgetViewModel(
            data: data, overview: { _ in BudgetFixtures.overview },
            now: { Date(timeIntervalSince1970: 1_796_083_200) })
    }

    private let member = """
        [{"household_id":"h","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z",\
        "id":"m1","name":"Ada","date_of_birth":null,"email":null,"up_connected_at":null,\
        "up_sync_failed_at":null,"user_id":"u-m1"}]
        """

    @Test func loadsEveryTableThenShowsTheOverview() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.overview == BudgetFixtures.overview)
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(
            Set(server.paths) == [
                "budget_line", "member_allowance", "members", "accounts", "savings_goal",
                "temporary_item",
            ])
    }

    @Test func theSignedInMemberIsTheOneWithTheirUserID() async {
        let server = Server()
        server.bodies["members"] = member
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.currentMemberID == "m1")
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["budget_line"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedOverview() async {
        let server = Server()
        let dir = directory()
        await model(makeData(server, directory: dir)).load()
        server.failing = ["budget_line"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.overview == BudgetFixtures.overview)
        #expect(error?.code == .server)
    }
}

@Suite struct BudgetLabelTests {
    @Test func labelsCadencesAsThePWADoes() {
        #expect(Frequency.weekly.label(interval: nil) == "Weekly")
        #expect(Frequency.biannual.label(interval: nil) == "Biannually")
        #expect(Frequency.everyNWeeks.label(interval: 3) == "Every 3 weeks")
        #expect(Frequency.everyNMonths.label(interval: 1) == "Every month")
        #expect(Frequency.everyNMonths.label(interval: nil) == "Every N months")
    }

    @Test func stripsALeadingEmojiFromAccountNames() {
        #expect(accountLabel("🏠 Bills") == "Bills")
        #expect(accountLabel("Bills") == "Bills")
        #expect(accountLabel("🏠") == "🏠")
    }

    @Test func formatsISODates() {
        #expect(BudgetPresentation.date("2027-03-31") == "31 Mar 2027")
    }

    @Test func theOverdrawGuardIsFixedCopy() {
        #expect(BudgetPresentation.overdrawGuard.contains("cannot draw more than is left"))
    }
}
