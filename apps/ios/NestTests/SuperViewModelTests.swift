import Foundation
import Testing

@testable import Nest

private enum SuperStub {
    static let summary = SuperSummary(
        preservationAge: 60,
        defaultAssumptions: .init(
            retirementAge: 60, expectedReturnPct: 7, inflationPct: 2.5, contributionGrowthPct: 0),
        members: [
            .init(
                memberId: "m1",
                caps: .init(
                    concessionalCents: 20_000_00, concessionalCapCents: 30_000_00,
                    concessionalOverCap: false, nonConcessionalCents: 130_000_00,
                    nonConcessionalCapCents: 120_000_00, nonConcessionalOverCap: true,
                    coContributionCents: 0),
                netAnnualContributionCents: 17_000_00, effectiveBalanceCents: 250_000_00)
        ])

    static let projection = SuperProjection(
        nominalCents: 900_000_00, realCents: 600_000_00, yearsToRetirement: 25)

    static let bodies: [String: String] = [
        "members": """
            [{"id":"m1","household_id":"h","name":"Ada","email":null,"user_id":"u","date_of_birth":null,\
            "up_connected_at":null,"up_sync_failed_at":null,\
            "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
            """
    ]
}

@MainActor
@Suite struct SuperViewModelTests {
    private final class Server: @unchecked Sendable {
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
                        Data((failed ? "{}" : SuperStub.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("SuperViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func defaults() -> UserDefaults {
        UserDefaults(suiteName: "SuperViewModelTests-\(UUID().uuidString)")!
    }

    private func model(_ data: NestData, defaults: UserDefaults) -> SuperViewModel {
        SuperViewModel(
            data: data, summarise: { _ in SuperStub.summary }, project: { input in
                input.entries.map { $0.age == nil ? nil : SuperStub.projection }
            }, defaults: defaults)
    }

    @Test func loadsEveryTableThenShowsTheSummary() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()), defaults: defaults())
        await model.load()
        #expect(model.state.value?.summary == SuperStub.summary)
        #expect(model.projections.count == 1 && model.projections[0] == nil)
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(
            Set(server.paths)
                == ["members", "inflows", "super_profile", "super_contribution", "accounts_with_balance"])
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["super_profile"]
        let model = model(makeData(server, directory: directory()), defaults: defaults())
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
        let store = defaults()
        await model(makeData(server, directory: dir), defaults: store).load()
        server.failing = ["inflows"]
        let again = model(makeData(server, directory: dir), defaults: store)
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.summary == SuperStub.summary)
        #expect(error?.code == .server)
    }

    @Test func assumptionsDefaultToThePreservationAgeThenPersist() async {
        let store = defaults()
        let model = model(makeData(Server(), directory: directory()), defaults: store)
        await model.load()
        #expect(model.effectiveAssumptions?.retirementAge == 60)
        await model.setAssumption(\.expectedReturnPct, to: 8.5)
        await model.setAssumption(\.inflationPct, to: nil)
        await model.setAge(40, for: "m1")
        #expect(model.projections == [SuperStub.projection])

        let reloaded = self.model(makeData(Server(), directory: directory()), defaults: store)
        await reloaded.load()
        #expect(reloaded.effectiveAssumptions?.expectedReturnPct == 8.5)
        #expect(reloaded.effectiveAssumptions?.inflationPct == 0)
        #expect(reloaded.effectiveAssumptions?.retirementAge == 60)
        #expect(reloaded.ages == ["m1": 40])
    }
}

@Suite struct SuperPresentationTests {
    private func contribution(
        kind: SuperContributionKind = .salarySacrifice, mode: SuperContributionMode = .amount,
        amount: Int? = nil, percentBp: Int? = nil
    ) throws -> SuperContribution {
        let json = """
            {"id":"c","household_id":"h","member_id":"m1","financial_year":2027,"kind":"\(kind.rawValue)",\
            "mode":"\(mode.rawValue)","amount_cents":\(amount.map(String.init) ?? "null"),\
            "percent_bp":\(percentBp.map(String.init) ?? "null"),"frequency":"monthly","interval_count":null,\
            "fhss_eligible":false,"contributor_member_id":null,\
            "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
            """
        return try JSONDecoder().decode(SuperContribution.self, from: Data(json.utf8))
    }

    @Test func valuesReadAsTheirAmountOrPercentOfSalary() throws {
        #expect(SuperPresentation.value(try contribution(amount: 1_500_00)) == "$1,500.00")
        #expect(
            SuperPresentation.value(try contribution(mode: .percent, percentBp: 1_050))
                == "10.5% of salary")
        #expect(
            SuperPresentation.value(try contribution(mode: .percent, percentBp: 1_000))
                == "10% of salary")
    }

    @Test func labelsKinds() {
        #expect(SuperPresentation.kindLabel(.personalDeductible) == "Personal (deductible)")
        #expect(SuperPresentation.kindLabel(.spouse) == "Spouse")
    }

    @Test func capsWarnOnlyWhenExceeded() {
        let row = SuperPresentation.caps(SuperStub.summary.members[0].caps!)
        #expect(row.lines[0].warning == nil)
        #expect(
            row.lines[1].warning
                == "Over the non-concessional cap ($120,000.00) — unless bring-forward applies.")
        #expect(row.coContribution == nil)
    }

    @Test func growthShareSplitsTheNominalBalance() {
        #expect(SuperPresentation.growthShare(currentCents: 250, nominalCents: 1_000) == (25, 75))
        #expect(SuperPresentation.growthShare(currentCents: 2_000, nominalCents: 1_000) == (100, 0))
        #expect(SuperPresentation.growthShare(currentCents: 5, nominalCents: 0) == (0, 0))
    }
}
