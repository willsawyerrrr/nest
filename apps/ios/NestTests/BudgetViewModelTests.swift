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
        private var recorded: [(method: String, path: String, body: String)] = []
        var requests: [(method: String, path: String, body: String)] { lock.withLock { recorded } }
        var paths: [String] { requests.map(\.path) }
        func record(_ request: URLRequest, table: String) {
            lock.withLock {
                recorded.append(
                    (
                        request.httpMethod ?? "", table,
                        String(decoding: request.httpBody ?? Data(), as: UTF8.self)
                    ))
            }
        }
    }

    private func makeData(_ server: Server, directory: URL, user: String = "u-m1") -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(request, table: table)
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

    private func planning() -> PlanningStore {
        PlanningStore(defaults: UserDefaults(suiteName: "BudgetViewModelTests-\(UUID().uuidString)")!)
    }

    private func model(_ data: NestData, planning: PlanningStore? = nil) -> BudgetViewModel {
        BudgetViewModel(
            data: data, overview: { _ in BudgetFixtures.overview },
            now: { Date(timeIntervalSince1970: 1_796_083_200) }, planning: planning ?? self.planning())
    }

    @Test func theLineSortPersistsUnderThePWAKey() {
        let defaults = UserDefaults(suiteName: "BudgetLineSort-\(UUID())")!
        let data = makeData(Server(), directory: directory())
        let model = BudgetViewModel(data: data, planning: planning(), defaults: defaults)
        #expect(model.lineSort == BudgetLineSort())
        model.lineSort = BudgetLineSort(key: .amount, direction: .desc)
        #expect(BudgetLineSort.stored(in: defaults) == BudgetLineSort(key: .amount, direction: .desc))
        #expect(defaults.data(forKey: "budget-line-sort") != nil)
    }

    private static let lineJSON = """
        [{"id":"b1","household_id":"h","name":"Gym","line_group":"wants","amount_cents":5000,\
        "frequency":"fortnightly","interval_count":null,"allowance_member_id":null,\
        "breakdown_id":null,"destination_account_id":"a1","gift_recipient_member_id":null,\
        "goal_id":null,"is_gift_line":false,"management_url":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"},\
        {"id":"b2","household_id":"h","name":"Medications","line_group":"needs","amount_cents":3000,\
        "frequency":"monthly","interval_count":null,"allowance_member_id":null,\
        "breakdown_id":"k1","destination_account_id":null,"gift_recipient_member_id":null,\
        "goal_id":null,"is_gift_line":false,"management_url":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """

    private func object(_ body: String) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
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
                "budget_line", "member_allowance", "members", "account_directory", "savings_goal",
                "temporary_item", "breakdown", "super_profile",
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

    @Test func creatingPostsTheLineWithTheHouseholdAndExplicitNulls() async throws {
        let server = Server()
        server.bodies["members"] = member
        let model = model(makeData(server, directory: directory()))
        await model.load()
        var form = BudgetLineFormState(defaultGroup: .wants)
        form.name = "Dining out"
        form.amount = "250.50"
        form.managementUrl = "netflix.com/account"
        try await model.createLine(try #require(form.input))
        let post = try #require(server.requests.first { $0.method == "POST" })
        #expect(post.path == "budget_line")
        let body = try object(post.body)
        #expect(body["household_id"] as? String == "h")
        #expect(body["amount_cents"] as? Int == 250_50)
        #expect(body["management_url"] as? String == "https://netflix.com/account")
        #expect(body["goal_id"] is NSNull)
        #expect(body["allowance_member_id"] is NSNull)
    }

    @Test func updatingPatchesTheLineAndDeletingRemovesIt() async throws {
        let server = Server()
        server.bodies["budget_line"] = Self.lineJSON
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let line = try #require(model.state.value?.rows.budgetLines.first)
        var form = BudgetLineFormState(initial: line)
        form.setGroup(.savings)
        try await model.updateLine(id: "b1", try #require(form.input))
        try await model.deleteLine(id: "b1")
        let patch = try #require(server.requests.first { $0.method == "PATCH" })
        // A savings line routes through its goal, so the funding account is cleared.
        #expect(try object(patch.body)["destination_account_id"] is NSNull)
        #expect(server.requests.contains { $0.method == "DELETE" && $0.path == "budget_line" })
    }

    @Test func aGenericDerivedLineEditWritesItsBreakdownThenTheLine() async throws {
        let server = Server()
        server.bodies["budget_line"] = Self.lineJSON
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let line = try #require(model.state.value?.rows.budgetLines.last)
        try await model.updateDerivedLine(
            line, DerivedLineValues(name: "Meds", group: .wants, destinationAccountId: "a1"))
        let patches = server.requests.filter { $0.method == "PATCH" }
        #expect(patches.map(\.path) == ["breakdown", "budget_line"])
        let breakdown = try object(patches[0].body)
        #expect(breakdown["name"] as? String == "Meds")
        #expect(breakdown["line_group"] as? String == "wants")
        let written = try object(patches[1].body)
        #expect(written["amount_cents"] as? Int == 3000)
        #expect(written["breakdown_id"] as? String == "k1")
        #expect(written["destination_account_id"] as? String == "a1")
    }

    @Test func anAllowanceEditPatchesItsRow() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        try await model.updateAllowance(
            id: "al1",
            MemberAllowanceInput(
                amountCents: 300_00, frequency: .everyNMonths, intervalCount: 2,
                destinationAccountId: nil))
        let patch = try #require(server.requests.first { $0.method == "PATCH" })
        #expect(patch.path == "member_allowance")
        #expect(try object(patch.body)["destination_account_id"] is NSNull)
    }

    @Test func whilePlanningLineWritesGoIntoTheSandboxNotTheDatabase() async throws {
        let server = Server()
        server.bodies["budget_line"] = Self.lineJSON
        server.bodies["members"] = member
        let store = planning()
        let model = model(makeData(server, directory: directory()), planning: store)
        await model.load()
        store.enter()
        #expect(model.isPlanning)
        let line = try #require(model.state.value?.rows.budgetLines.first)
        var form = BudgetLineFormState(initial: line)
        form.amount = "75"
        try await model.updateLine(id: "b1", try #require(form.input))
        try await model.deleteLine(id: "b2")
        var created = BudgetLineFormState(defaultGroup: .needs)
        created.name = "Insurance"
        created.amount = "120"
        try await model.createLine(try #require(created.input))
        #expect(!server.requests.contains { ["PATCH", "POST", "DELETE"].contains($0.method) })
        #expect(store.state.layer(.budgetLine).deletes == ["b2"])
        #expect(store.state.layer(.budgetLine).updates["b1"]?["amount_cents"] == .int(75_00))
        let lines = try #require(model.state.value?.rows.budgetLines)
        #expect(lines.map(\.name) == ["Gym", "Insurance"])
    }

    @Test func anOverdrawRefusalReadsAsTheFixedCopy() {
        let refused = NestError(.invalidRequest, refusal: AllowanceCopy.refusal)
        #expect(BudgetLineFormState.failureMessage(refused) == AllowanceCopy.itemOverdraws)
        #expect(MemberAllowanceFormState.failureMessage(refused) == AllowanceCopy.belowDrawn)
        #expect(
            BudgetLineFormState.failureMessage(NestError(.server))
                == "Could not save this budget item. Please try again.")
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
