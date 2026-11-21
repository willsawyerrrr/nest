import Foundation
import Testing

@testable import Nest

private enum Fixtures {
    static let summary = BudgetSummary(
        oneOffCents: 0,
        available: .init(fortnightlyCents: 100_00, annualCents: 2_600_00),
        groups: .init(
            needs: group(40_00), wants: group(0), discretionary: group(0), temporary: group(0),
            savings: group(10_00), investments: group(0)),
        allowances: [],
        outgoings: .init(fortnightlyCents: 40_00, annualCents: 1_040_00),
        savingsBlock: .init(fortnightlyCents: 10_00, annualCents: 260_00),
        afterOutgoing: .init(fortnightlyCents: 60_00, annualCents: 1_560_00),
        afterSaving: .init(fortnightlyCents: 50_00, annualCents: 1_300_00),
        tax: .init(fortnightlyCents: 30_00, annualCents: 780_00),
        salarySacrifice: .init(fortnightlyCents: 5_00, annualCents: 130_00))

    static func group(_ cents: Int64) -> BudgetSummary.Group {
        .init(fortnightlyCents: cents, annualCents: cents * 26, portion: 0)
    }
}

@MainActor
@Suite struct SummaryViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [:]
        var failing: Set<String> = []
        var headers: [String: [String: String]] = [:]
        private let lock = NSLock()
        private var recorded: [URLRequest] = []
        var paths: [String] { lock.withLock { recorded.map(Self.table) } }
        var requests: [URLRequest] { lock.withLock { recorded } }
        func record(_ request: URLRequest) { lock.withLock { recorded.append(request) } }
        static func table(_ request: URLRequest) -> String {
            request.url!.path.split(separator: "/").last.map(String.init) ?? ""
        }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = Server.table(request)
                    server.record(request)
                    let failed = server.failing.contains(table)
                    return (
                        Data((failed ? "{}" : server.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: server.headers[table])!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("SummaryViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(
        _ data: NestData, defaults: UserDefaults = UserDefaults(suiteName: UUID().uuidString)!,
        planning: PlanningStore = PlanningStore(
            defaults: UserDefaults(suiteName: UUID().uuidString)!),
        summarise: @escaping @Sendable (SummaryInput) async throws -> BudgetSummary = { _ in
            Fixtures.summary
        }
    ) -> SummaryViewModel {
        SummaryViewModel(
            data: data, summarise: summarise, cashFlow: { _ in Self.cashFlow },
            now: { Date(timeIntervalSince1970: 1_796_083_200) }, defaults: defaults,
            planning: planning)
    }

    @Test func planningModeComputesTheSandboxAgainstTheRealBaseline() async {
        let server = Server()
        server.bodies["inflows"] = #"""
            [{"id":"i1","household_id":"h","name":"Pay","type":"salary","taxable":true,
            "attracts_super":true,"arrives_every_pay_period":true,"is_joint":false,
            "schedule":"annual","amount_cents":100,"created_at":"t","updated_at":"t"}]
            """#
        server.bodies["members"] = #"""
            [{"id":"m","household_id":"h","name":"Ada","user_id":"u","created_at":"t","updated_at":"t"}]
            """#
        let store = PlanningStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        store.select(household: "h")
        store.enter()
        store.update(.inflows, id: "i1", patch: ["amount_cents": .int(500)])
        let model = model(
            makeData(server, directory: directory()), planning: store,
            summarise: { input in
                var summary = Fixtures.summary
                summary.oneOffCents = Int64(input.bundle.inflows.first?.amountCents ?? 0)
                return summary
            })
        await model.load()
        #expect(model.state.value?.summary.oneOffCents == 500)
        #expect(model.state.value?.baseline?.oneOffCents == 100)
    }

    nonisolated private static let cashFlow: CashFlowGraphs = {
        let graph = CashFlowGraph(
            nodes: [
                .init(name: "Available", color: .buffer, valueCents: 100_00),
                .init(name: "Buffer", color: .buffer, valueCents: 100_00),
            ],
            links: [.init(source: 0, target: 1, value: 100_00)])
        return CashFlowGraphs(
            takeHome: .init(grouped: graph, drilled: graph), gross: .init(grouped: graph, drilled: graph),
            hasLines: false)
    }()

    @Test func carriesTheCashFlowGraphs() async {
        let model = model(makeData(Server(), directory: directory()))
        await model.load()
        #expect(model.state.value?.cashFlow == Self.cashFlow)
        #expect(Self.cashFlow.takeHome.grouped.descriptions == ["Available to Buffer: $100.00"])
    }

    @Test func withoutPlanningModeThereIsNoBaseline() async {
        let model = model(makeData(Server(), directory: directory()))
        await model.load()
        #expect(model.state.value?.baseline == nil)
    }

    @Test func loadsEveryTableThenShowsTheSummary() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.summary == Fixtures.summary)
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(
            Set(server.paths) == [
                "inflows", "tax_profile", "super_contribution", "help_debt", "deduction", "members",
                "budget_line", "member_allowance", "temporary_item", "savings_goal",
                "accounts_with_balance", "notification_preference",
            ])
    }

    private static func preference(enabled: Bool) -> String {
        #"""
        [{"id":"p","household_id":"h","member_id":"m","trigger":"transaction_review",
        "enabled":\#(enabled),"created_at":"t","updated_at":"t"}]
        """#
    }

    @Test func anAbsentReviewPreferenceShowsNoPromptAndCountsNothing() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.toReview == nil)
        #expect(!server.paths.contains("transactions"))
        let preferences = server.requests.first { Server.table($0) == "notification_preference" }
        #expect(preferences?.url?.query?.contains("trigger=eq.transaction_review") == true)
    }

    @Test func aDisabledReviewPreferenceShowsNoPrompt() async {
        let server = Server()
        server.bodies["notification_preference"] = Self.preference(enabled: false)
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.toReview == nil)
        #expect(!server.paths.contains("transactions"))
    }

    @Test func anEnabledReviewPreferenceCountsTheTransactionsAwaitingReview() async throws {
        let server = Server()
        server.bodies["notification_preference"] = Self.preference(enabled: true)
        server.headers["transactions"] = ["Content-Range": "0-2/3"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.toReview == 3)
        let count = try #require(server.requests.first { Server.table($0) == "transactions" })
        #expect(count.httpMethod == "HEAD")
        let items = URLComponents(url: count.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(
            Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") }) == [
                "select": "id", "source": "eq.up", "is_categorizable": "eq.true",
                "reviewed_at": "is.null",
            ])
    }

    @Test func aFailedCountShowsNoPrompt() async {
        let server = Server()
        server.bodies["notification_preference"] = Self.preference(enabled: true)
        server.failing = ["transactions"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.toReview == nil)
        #expect(model.state.value?.summary == Fixtures.summary)
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["inflows"]
        let model = model(makeData(server, directory: directory()))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedSummary() async {
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
        #expect(content.summary == Fixtures.summary)
        #expect(error?.code == .server)
    }

    @Test func persistsTheIncomeBasis() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let first = model(makeData(Server(), directory: directory()), defaults: defaults)
        #expect(first.basis == .takeHome)
        first.basis = .gross
        let second = model(makeData(Server(), directory: directory()), defaults: defaults)
        #expect(second.basis == .gross)
    }
}

@Suite struct SummaryPresentationTests {
    private let presentation = SummaryPresentation(summary: Fixtures.summary)

    @Test func grossAddsTaxAndSacrificeToAvailable() {
        #expect(presentation.gross.fortnightlyCents == 135_00)
    }

    @Test func takeHomeSegmentsAreGroupsThenBuffer() {
        #expect(presentation.segments(.takeHome).map(\.name) == ["Needs", "Savings", "Buffer"])
        #expect(presentation.segments(.gross).map(\.name) == [
            "Tax", "Salary sacrifice", "Needs", "Savings", "Buffer",
        ])
    }

    @Test func ledgerOrdersRunningFiguresBetweenGroups() {
        #expect(presentation.ledger(.takeHome).map(\.label) == [
            "Available", "Needs", "Wants", "Discretionary", "Temporary", "After Outgoing",
            "Savings", "Investments", "After Saving",
        ])
        #expect(presentation.ledger(.gross).prefix(3).map(\.label) == ["Gross", "Tax", "Salary sacrifice"])
    }

    @Test func reviewDetailPluralisesTheTransactions() {
        #expect(SummaryPresentation.reviewDetail(1) == "Confirm the category of your new Up transaction.")
        #expect(SummaryPresentation.reviewDetail(2) == "Confirm the category of your new Up transactions.")
    }

    @Test func portionsDivideByTheBasis() {
        #expect(SummaryPresentation.percent(presentation.portion(of: 40_00, basis: .takeHome)) == "40.0%")
        #expect(presentation.portion(of: 1, basis: .takeHome) > 0)
    }
}
