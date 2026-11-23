import Foundation
import Testing

@testable import Nest

/// A stubbed Supabase: each path's body by its last component, a set failing with a 500.
private final class Server: @unchecked Sendable {
    private let lock = NSLock()
    var bodies: [String: String] = [:]
    var failing: Set<String> = []
    private var recorded: [URLRequest] = []
    var requests: [URLRequest] { lock.withLock { recorded } }

    func data(directory: URL = FileManager.default.temporaryDirectory
        .appendingPathComponent("ActualSpendTests-\(UUID().uuidString)", isDirectory: true)
    ) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let name = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    let (body, failed) = self.lock.withLock {
                        self.recorded.append(request)
                        return (self.bodies[name] ?? "[]", self.failing.contains(name))
                    }
                    return (
                        Data((failed ? "{}" : body).utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    func body(of path: String, method: String) -> String? {
        requests.last { $0.url?.path == path && $0.httpMethod == method }
            .map { String(decoding: $0.httpBody ?? Data(), as: UTF8.self) }
    }
}

private let salary = """
    [{"id":"i1","household_id":"h","member_id":"m1","name":"Pay","type":"salary",\
    "amount_cents":100000,"schedule":"annual","interval_count":null,"pay_schedule":"fortnightly",\
    "pay_interval_count":null,"pay_anchor_date":"2026-07-09","paid_on":null,"starts_on":null,\
    "ends_on":null,"taxable":true,"attracts_super":true,"arrives_every_pay_period":true,\
    "hourly_rate_cents":null,"hours_per_period":null,"is_joint":false,"member_split_percent":null,\
    "one_off_tax_treatment":null,"years_of_service":null,\
    "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
    """

@MainActor
@Suite struct ActualSpendViewModelTests {
    /// 2026-11-23T01:00:00Z, the 23rd in Australia and in UTC.
    nonisolated private static let now = Date(timeIntervalSince1970: 1_795_395_600)

    private func model(
        _ server: Server, data: NestData? = nil,
        offsets: OffsetLog = OffsetLog()
    ) -> ActualSpendViewModel {
        ActualSpendViewModel(
            data: data ?? server.data(),
            fortnight: { input in
                offsets.record(input)
                let start = input.offset == 0 ? "2026-11-12" : "2026-10-29"
                return SpendPeriod(periodStart: start, periodEnd: input.offset == 0 ? "2026-11-25" : "2026-11-11")
            },
            fold: { input in
                var groups = BudgetOverview.Groups(needs: 0, wants: 0, discretionary: 0, savings: 0, investments: 0)
                var unbudgeted: Int64 = 0
                for row in input.rows {
                    switch row.lineGroup {
                    case .needs: groups.needs += row.spentCents
                    case .wants: groups.wants += row.spentCents
                    case .discretionary: groups.discretionary += row.spentCents
                    case .savings: groups.savings += row.spentCents
                    case .investments: groups.investments += row.spentCents
                    case nil: unbudgeted += row.spentCents
                    }
                }
                return ActualSpend(groups: groups, unbudgeted: unbudgeted)
            },
            now: { Self.now })
    }

    final class OffsetLog: @unchecked Sendable {
        private let lock = NSLock()
        private var inputs: [SpendFortnightInput] = []
        func record(_ input: SpendFortnightInput) { lock.withLock { inputs.append(input) } }
        var last: SpendFortnightInput? { lock.withLock { inputs.last } }
    }

    @Test func loadsTheFortnightFromTheInflowsThenItsSpend() async throws {
        let server = Server()
        server.bodies["inflows"] = salary
        server.bodies["budget_actual_spend"] =
            #"[{"line_group":"needs","spent_cents":41250},{"line_group":null,"spent_cents":4510}]"#
        let offsets = OffsetLog()
        let model = model(server, offsets: offsets)

        await model.load()

        let input = try #require(offsets.last)
        #expect(input.today == InflowsPresentation.isoDate(Self.now))
        #expect(input.offset == 0)
        #expect(input.inflows.map(\.payAnchorDate) == ["2026-07-09"])
        #expect(model.period == SpendPeriod(periodStart: "2026-11-12", periodEnd: "2026-11-25"))
        #expect(model.spend?.groups.needs == 41250)
        #expect(model.spend?.unbudgeted == 4510)
        #expect(model.error == nil)
        let body = try #require(server.body(of: "/rest/v1/rpc/budget_actual_spend", method: "POST"))
        let params = try JSONDecoder().decode([String: JSONScalar].self, from: Data(body.utf8))
        #expect(params["p_start"] == .string("2026-11-12"))
        #expect(params["p_end"] == .string("2026-11-25"))
        #expect(params["p_include_pending"] == .bool(false))
    }

    @Test func stepsBackButNeverPastTheCurrentFortnight() async {
        let server = Server()
        let offsets = OffsetLog()
        let model = model(server, offsets: offsets)
        #expect(model.isCurrent)
        model.next()
        #expect(model.offset == 0)
        model.previous()
        #expect(!model.isCurrent)
        await model.load()
        #expect(offsets.last?.offset == -1)
        #expect(model.period?.periodStart == "2026-10-29")
        model.next()
        model.next()
        #expect(model.offset == 0)
    }

    @Test func includingPendingAsksForPendingSpend() async throws {
        let server = Server()
        let model = model(server)
        model.includePending = true
        await model.load()
        let body = try #require(server.body(of: "/rest/v1/rpc/budget_actual_spend", method: "POST"))
        #expect(body.contains(#""p_include_pending":true"#))
    }

    @Test func aFailedSpendReadReportsTheErrorAndKeepsThePeriod() async {
        let server = Server()
        server.failing = ["budget_actual_spend"]
        let model = model(server)
        await model.load()
        #expect(model.period != nil)
        #expect(model.spend == nil)
        #expect(model.error?.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedSpend() async {
        let server = Server()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ActualSpendTests-\(UUID().uuidString)", isDirectory: true)
        server.bodies["budget_actual_spend"] = #"[{"line_group":"wants","spent_cents":800}]"#
        await model(server, data: server.data(directory: directory)).load()

        server.failing = ["budget_actual_spend"]
        let model = model(server, data: server.data(directory: directory))
        await model.load()
        #expect(model.spend?.groups.wants == 800)
        #expect(model.error?.code == .server)
    }

    @Test func refreshingChangesTheRequest() {
        let model = model(Server())
        let before = model.request
        model.refresh()
        #expect(model.request != before)
    }
}

/// A JSON scalar, to read the RPC's arguments back.
private enum JSONScalar: Decodable, Equatable {
    case string(String)
    case bool(Bool)

    init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let value = try? single.decode(Bool.self) {
            self = .bool(value)
        } else {
            self = .string(try single.decode(String.self))
        }
    }
}

@MainActor
@Suite struct CategoryGroupsViewModelTests {
    private static let categories = """
        [{"id":"good-life","name":"Good Life","parent_id":null},\
        {"id":"booze","name":"Booze","parent_id":"good-life"},\
        {"id":"restaurants-and-cafes","name":"Restaurants & Cafes","parent_id":"good-life"},\
        {"id":"personal","name":"Personal","parent_id":null},\
        {"id":"investments","name":"Investments","parent_id":"personal"},\
        {"id":"technology","name":"Technology","parent_id":"personal"}]
        """
    private static let defaults = """
        [{"category_id":"booze","line_group":"discretionary"},\
        {"category_id":"restaurants-and-cafes","line_group":"wants"},\
        {"category_id":"investments","line_group":"investments"}]
        """
    private static let overrides = """
        [{"household_id":"h","category_id":"restaurants-and-cafes","line_group":"needs",\
        "updated_at":"2026-11-01T00:00:00Z"},\
        {"household_id":"h","category_id":"investments","line_group":null,\
        "updated_at":"2026-11-01T00:00:00Z"}]
        """
    private static let members = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Ada","date_of_birth":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """

    private func server() -> Server {
        let server = Server()
        server.bodies["up_category"] = Self.categories
        server.bodies["up_category_default_group"] = Self.defaults
        server.bodies["up_category_group"] = Self.overrides
        server.bodies["members"] = Self.members
        return server
    }

    @Test func listsEachChildUnderItsParentWithItsDefaultAndOverride() async {
        let model = CategoryGroupsViewModel(data: server().data())
        await model.load()
        let sections = model.state.value ?? []
        #expect(sections.map(\.name) == ["Good Life", "Personal"])
        #expect(
            sections[0].rows == [
                CategoryGroupRow(id: "booze", name: "Booze", defaultGroup: .discretionary, choice: .shared),
                CategoryGroupRow(
                    id: "restaurants-and-cafes", name: "Restaurants & Cafes", defaultGroup: .wants,
                    choice: .override(.needs)),
            ])
        #expect(
            sections[1].rows == [
                CategoryGroupRow(
                    id: "investments", name: "Investments", defaultGroup: .investments,
                    choice: .override(nil)),
                CategoryGroupRow(id: "technology", name: "Technology", defaultGroup: nil, choice: .shared),
            ])
    }

    @Test func noGroupUpsertsANullOverrideForTheHousehold() async throws {
        let server = server()
        let model = CategoryGroupsViewModel(data: server.data())
        await model.load()
        let booze = try #require(model.state.value?.first?.rows.first)

        await model.set(booze, to: .override(nil))

        let request = try #require(
            server.requests.last { $0.httpMethod == "POST" && $0.url?.path == "/rest/v1/up_category_group" })
        #expect(request.url?.query?.contains("on_conflict=household_id,category_id") == true)
        let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        #expect(body.contains(#""line_group":null"#))
        #expect(body.contains(#""household_id":"h""#))
        #expect(body.contains(#""category_id":"booze""#))
        #expect(model.failure == nil)
    }

    @Test func theDefaultDeletesTheOverride() async throws {
        let server = server()
        let model = CategoryGroupsViewModel(data: server.data())
        await model.load()
        let restaurants = try #require(model.state.value?.first?.rows.last)

        await model.set(restaurants, to: .shared)

        let request = try #require(server.requests.last { $0.httpMethod == "DELETE" })
        #expect(request.url?.path == "/rest/v1/up_category_group")
        let query = request.url?.query ?? ""
        #expect(query.contains("household_id=eq.h"))
        #expect(query.contains("category_id=eq.restaurants-and-cafes"))
    }

    @Test func aFailedChangeShowsFixedCopy() async throws {
        let server = server()
        let model = CategoryGroupsViewModel(data: server.data())
        await model.load()
        let booze = try #require(model.state.value?.first?.rows.first)
        server.failing = ["up_category_group"]

        await model.set(booze, to: .override(.wants))

        #expect(model.failure == "Couldn’t change Booze’s group. Try again.")
    }

    @Test func aFailedLoadFails() async {
        let server = server()
        server.failing = ["up_category_default_group"]
        let model = CategoryGroupsViewModel(data: server.data())
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("expected a failed state")
            return
        }
        #expect(error.code == .server)
    }
}

@Suite struct ActualSpendPresentationTests {
    @Test func wordsTheBarAsThePWADoes() {
        #expect(ActualSpendPresentation.heading(isCurrent: true) == "Spent this fortnight")
        #expect(ActualSpendPresentation.heading(isCurrent: false) == "Spent that fortnight")
        #expect(
            ActualSpendPresentation.periodLabel(
                SpendPeriod(periodStart: "2026-11-12", periodEnd: "2026-11-25"))
                == "12 Nov 2026 – 25 Nov 2026")
        #expect(ActualSpendPresentation.unbudgeted(0) == nil)
        #expect(ActualSpendPresentation.unbudgeted(45_10) == "$45.10 in no group")
    }

    @Test func showsWhatIsLeftOrOver() {
        let under = ActualSpendPresentation.groupSpend(plannedCents: 500_00, spentCents: 412_50)
        #expect(under == .init(spent: "$412.50 spent", remaining: "$87.50 left", sign: .positive))
        let over = ActualSpendPresentation.groupSpend(plannedCents: 100_00, spentCents: 112_00)
        #expect(over == .init(spent: "$112.00 spent", remaining: "$12.00 over", sign: .negative))
        let even = ActualSpendPresentation.groupSpend(plannedCents: 100_00, spentCents: 100_00)
        #expect(even.remaining == "$0.00 left")
        #expect(even.sign == .zero)
    }

    @Test func labelsEachChoice() {
        #expect(ActualSpendPresentation.choiceLabel(.shared, defaultGroup: .needs) == "Default (Needs)")
        #expect(ActualSpendPresentation.choiceLabel(.shared, defaultGroup: nil) == "Default (No group)")
        #expect(ActualSpendPresentation.choiceLabel(.override(.wants), defaultGroup: .needs) == "Wants")
        #expect(ActualSpendPresentation.choiceLabel(.override(nil), defaultGroup: .needs) == "No group")
        #expect(
            ActualSpendPresentation.choices == [
                .shared, .override(.needs), .override(.wants), .override(.discretionary),
                .override(.savings), .override(.investments), .override(nil),
            ])
    }
}
