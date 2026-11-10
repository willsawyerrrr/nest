import Foundation
import Testing

@testable import Nest

private enum InflowStubs {
    static let figures = InflowFortnightlies(
        items: [.init(inflowId: "i1", fortnightlyCents: 4_615_38)])

    static let inflowJSON = """
        [{"id":"i1","household_id":"h","name":"Salary","taxable":true,"member_id":"m1",\
        "type":"salary","attracts_super":true,"schedule":"annual","amount_cents":12000000,\
        "hourly_rate_cents":null,"hours_per_period":null,"interval_count":null,\
        "pay_schedule":"fortnightly","pay_interval_count":null,"arrives_every_pay_period":true,\
        "starts_on":null,"ends_on":null,"paid_on":null,"one_off_tax_treatment":null,\
        "years_of_service":null,"is_joint":false,"member_split_percent":null,\
        "pay_anchor_date":null,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let memberJSON = """
        [{"id":"m1","household_id":"h","name":"Alex","email":null,"user_id":"u",\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """

    static func inflow(_ json: String = inflowJSON) -> [Inflow] {
        try! JSONDecoder().decode([Inflow].self, from: Data(json.utf8))
    }

    static func members() -> [Member] {
        try! JSONDecoder().decode([Member].self, from: Data(memberJSON.utf8))
    }
}

@MainActor
@Suite struct InflowsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "inflows": InflowStubs.inflowJSON, "members": InflowStubs.memberJSON,
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(method: String, path: String, body: String)] = []
        var requests: [(method: String, path: String, body: String)] { lock.withLock { recorded } }
        func record(_ request: URLRequest) {
            lock.withLock {
                recorded.append(
                    (
                        request.httpMethod ?? "", request.url!.path.split(separator: "/").last.map(String.init) ?? "",
                        String(decoding: request.httpBody ?? Data(), as: UTF8.self)
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
                    server.record(request)
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
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
            .appendingPathComponent("InflowsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func planning() -> PlanningStore {
        PlanningStore(defaults: UserDefaults(suiteName: "InflowsViewModelTests-\(UUID().uuidString)")!)
    }

    private func model(_ data: NestData, planning: PlanningStore? = nil) -> InflowsViewModel {
        InflowsViewModel(
            data: data, summarise: { _ in InflowStubs.figures },
            previewDraft: { _ in InflowDraftPreview() }, planning: planning ?? self.planning())
    }

    @Test func loadsBothTablesThenShowsTheFigures() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.fortnightlies == InflowStubs.figures)
        #expect(model.state.value?.rows.inflows.map(\.name) == ["Salary"])
        #expect(model.state.value?.rows.members.map(\.name) == ["Alex"])
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
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
        server.failing = ["inflows"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.fortnightlies == InflowStubs.figures)
        #expect(error?.code == .server)
    }

    @Test func creatingPostsTheInputWithTheHouseholdAndExplicitNulls() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        var form = InflowFormState(members: InflowStubs.members())
        form.name = "Bonus"
        form.amount = "1000"
        try await model.create(try #require(form.input))
        let post = try #require(server.requests.first { $0.method == "POST" })
        #expect(post.path == "inflows")
        let object = try #require(
            try JSONSerialization.jsonObject(with: Data(post.body.utf8)) as? [String: Any])
        #expect(object["household_id"] as? String == "h")
        #expect(object["amount_cents"] as? Int == 100_000)
        #expect(object["paid_on"] is NSNull)
    }

    @Test func updatingPatchesTheRowAndDeletingRemovesIt() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        var form = InflowFormState(initial: InflowStubs.inflow()[0], members: InflowStubs.members())
        form.name = "Pay"
        try await model.update(id: "i1", try #require(form.input))
        try await model.delete(id: "i1")
        #expect(server.requests.contains { $0.method == "PATCH" && $0.body.contains("\"Pay\"") })
        #expect(server.requests.contains { $0.method == "DELETE" })
    }

    @Test func whilePlanningWritesGoIntoTheSandboxNotTheDatabase() async throws {
        let server = Server()
        let store = planning()
        let model = model(makeData(server, directory: directory()), planning: store)
        await model.load()
        store.enter()
        var form = InflowFormState(initial: InflowStubs.inflow()[0], members: InflowStubs.members())
        form.amount = "130000"
        try await model.update(id: "i1", try #require(form.input))
        try await model.delete(id: "i1")
        var created = InflowFormState(members: InflowStubs.members())
        created.name = "Bonus"
        created.amount = "500"
        try await model.create(try #require(created.input))
        #expect(!server.requests.contains { ["PATCH", "POST", "DELETE"].contains($0.method) })
        #expect(store.state.layer(.inflows).deletes == ["i1"])
        #expect(store.state.layer(.inflows).creates.count == 1)
    }
}

@Suite struct InflowsPresentationTests {
    private func inflow(_ overrides: [String: Any]) -> Inflow {
        var object =
            try! JSONSerialization.jsonObject(with: Data(InflowStubs.inflowJSON.utf8)) as! [[String: Any]]
        object[0].merge(overrides) { _, new in new }
        return try! JSONDecoder().decode(
            [Inflow].self, from: JSONSerialization.data(withJSONObject: object))[0]
    }

    @Test func subtitlePrefixesTheMemberOrMarksNonTaxable() {
        #expect(InflowsPresentation.subtitle(inflow([:]), memberName: "Alex") == "Alex · Salary")
        #expect(InflowsPresentation.subtitle(inflow([:]), memberName: nil) == "Salary")
        #expect(
            InflowsPresentation.subtitle(inflow(["taxable": false, "type": "gift"]), memberName: "Alex")
                == "Non-taxable · Gift")
    }

    @Test func describesAFlatAmountAndAWageRateTimesHours() {
        #expect(InflowsPresentation.describeAmount(inflow([:])) == "$120,000.00")
        let wage = inflow(["type": "wage", "hourly_rate_cents": 4550, "hours_per_period": 37.5])
        #expect(InflowsPresentation.describeAmount(wage) == "$45.50 × 37.5 hrs")
    }

    @Test func cadenceNamesTheAmountsPeriodOrOneOff() {
        #expect(InflowsPresentation.cadenceLabel(inflow([:])) == "Annually")
        #expect(
            InflowsPresentation.cadenceLabel(
                inflow(["schedule": "every_n_weeks", "interval_count": 4])) == "Every 4 weeks")
        #expect(
            InflowsPresentation.cadenceLabel(inflow(["schedule": NSNull(), "paid_on": "2026-12-25"]))
                == "One-off")
    }

    @Test func captionJoinsEveryQualificationThatApplies() {
        #expect(InflowsPresentation.caption(inflow([:])) == "Paid fortnightly")
        let full = inflow([
            "is_joint": true, "member_split_percent": 60, "arrives_every_pay_period": false,
            "starts_on": "2026-07-01", "ends_on": "2026-09-14",
        ])
        let caption = InflowsPresentation.caption(full)
        #expect(caption?.hasPrefix("Joint · 60% / 40% · Paid fortnightly · Only some pay periods · ") == true)
        #expect(caption?.contains(" – ") == true)
    }

    @Test func aOneOffCaptionNamesItsDateAndTreatment() {
        let oneOff = inflow([
            "schedule": NSNull(), "paid_on": "2026-11-20", "pay_schedule": NSNull(),
            "one_off_tax_treatment": "genuine_redundancy",
        ])
        #expect(
            InflowsPresentation.oneOffCaption(oneOff)?.hasSuffix(" · Genuine redundancy") == true)
    }

    @Test func endedInflowsSinkAndAOneOffPaidTodayIsStillLive() {
        let today = InflowsPresentation.parseIsoDate("2026-11-09")!
        #expect(InflowsPresentation.isEnded(inflow(["ends_on": "2026-11-08"]), now: today))
        #expect(!InflowsPresentation.isEnded(inflow(["ends_on": "2026-11-09"]), now: today))
        #expect(InflowsPresentation.isEnded(inflow(["paid_on": "2026-10-01"]), now: today))
        #expect(!InflowsPresentation.isEnded(inflow([:]), now: today))
    }
}

@Suite struct InflowFormStateTests {
    private let members = InflowStubs.members()

    @Test func aBlankFormCannotBeSavedUntilNamedAndPriced() {
        var form = InflowFormState(members: members)
        #expect(!form.canSubmit)
        form.name = "Pay"
        #expect(!form.canSubmit)
        form.amount = "100"
        #expect(form.canSubmit)
    }

    @Test func switchingToNonTaxableResetsTheTypeAndDropsTheMember() throws {
        var form = InflowFormState(members: members)
        form.name = "Gift"
        form.amount = "50"
        form.setTaxable(false)
        #expect(form.type == .reimbursement)
        let input = try #require(form.input)
        #expect(input.memberId == nil && input.attractsSuper)
    }

    @Test func aOneOffNeverHoldsAWageOrACadence() throws {
        var form = InflowFormState(members: members)
        form.setType(.wage)
        form.setOneOff(true)
        #expect(form.type == .salary)
        form.name = "Bonus"
        form.amount = "1000"
        #expect(!form.canSubmit)
        form.paidOn = "2026-12-01"
        let input = try #require(form.input)
        #expect(input.schedule == nil && input.paidOn == "2026-12-01")
        #expect(input.oneOffTaxTreatment == .ordinary && input.arrivesEveryPayPeriod)
    }

    @Test func aGenuineRedundancyNeedsYearsOfService() throws {
        var form = InflowFormState(members: members)
        form.name = "Redundancy"
        form.amount = "50000"
        form.setOneOff(true)
        form.paidOn = "2026-12-01"
        form.treatment = .genuineRedundancy
        #expect(!form.canSubmit)
        form.yearsOfService = "7"
        #expect(try #require(form.input).yearsOfService == 7)
    }

    @Test func onlyARecurringTaxableOtherCanBeJoint() throws {
        var form = InflowFormState(members: members)
        form.name = "Interest"
        form.amount = "10"
        form.setType(.other)
        #expect(form.jointEligible)
        form.isJoint = true
        form.splitPercent = "60"
        let input = try #require(form.input)
        #expect(input.isJoint && input.memberSplitPercent == 60)
        form.setType(.salary)
        #expect(!form.isJoint)
        #expect(try #require(form.input).memberSplitPercent == nil)
        form.setType(.other)
        form.isJoint = true
        form.splitPercent = "101"
        #expect(!form.canSubmit)
    }

    @Test func everyNNeedsAnIntervalOfAtLeastOne() throws {
        var form = InflowFormState(members: members)
        form.name = "Pay"
        form.amount = "10"
        form.schedule = .everyNWeeks
        #expect(!form.canSubmit)
        form.interval = "0"
        #expect(!form.canSubmit)
        form.interval = "3"
        #expect(try #require(form.input).intervalCount == 3)
    }

    @Test func aWageStoresRateAndHoursNotAnAmount() throws {
        var form = InflowFormState(members: members)
        form.name = "Wage"
        form.setType(.wage)
        form.hourlyRate = "45.50"
        form.hours = "37.5"
        let input = try #require(form.input)
        #expect(input.amountCents == nil && input.hourlyRateCents == 4550 && input.hoursPerPeriod == 37.5)
    }

    @Test func payCadenceAndArrivalApplyToTaxableRecurringInflowsOnly() throws {
        var form = InflowFormState(members: members)
        form.name = "Pay"
        form.amount = "10"
        form.paySchedule = .fortnightly
        form.arrivesEveryPeriod = false
        var input = try #require(form.input)
        #expect(input.paySchedule == .fortnightly && !input.arrivesEveryPayPeriod)
        form.setTaxable(false)
        input = try #require(form.input)
        #expect(input.paySchedule == nil && input.arrivesEveryPayPeriod)
    }

    @Test func anEditOpensWithTheSavedValues() {
        let form = InflowFormState(initial: InflowStubs.inflow()[0], members: members)
        #expect(form.name == "Salary" && form.amount == "120000.00" && form.schedule == .annual)
        #expect(form.paySchedule == .fortnightly && !form.isOneOff)
        #expect(form.arrivesAnnually == false)
    }
}
