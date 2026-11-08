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
        var paths: [String] = []
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.paths.append(table)
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
            .appendingPathComponent("SummaryViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(
        _ data: NestData, defaults: UserDefaults = UserDefaults(suiteName: UUID().uuidString)!
    ) -> SummaryViewModel {
        SummaryViewModel(
            data: data, summarise: { _ in Fixtures.summary },
            now: { Date(timeIntervalSince1970: 1_796_083_200) }, defaults: defaults)
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
                "accounts_with_balance",
            ])
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

    @Test func portionsDivideByTheBasis() {
        #expect(SummaryPresentation.percent(presentation.portion(of: 40_00, basis: .takeHome)) == "40.0%")
        #expect(presentation.portion(of: 1, basis: .takeHome) > 0)
    }
}
