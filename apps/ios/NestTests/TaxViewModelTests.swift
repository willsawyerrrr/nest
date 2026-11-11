import Foundation
import Testing

@testable import Nest

private enum TaxFixtures {
    static let breakdown = TaxBreakdown(
        taxableIncomeCents: 1, incomeForSurchargeCents: 1, incomeTaxCents: 1, litoOffsetCents: 0,
        oneOffOffsetCents: 0, medicareLevyCents: 0, medicareLevySurchargeCents: 0,
        helpRepaymentCents: 0, division293Cents: 0, totalLiabilityCents: 1, paygWithheldCents: 0,
        balanceCents: 0, repaymentIncomeCents: 1)
    static let household = TaxHouseholdFigures(
        annualGrossCents: 100, annualTaxCents: 20, annualAfterTaxCents: 80,
        annualOneOffGrossCents: 0, fortnightlyGrossCents: 4, fortnightlyTaxCents: 1,
        fortnightlyAfterTaxCents: 3, members: [])
    static let figures = TaxScreenFigures(
        financialYear: 2027, availableFinancialYears: [2027, 2026],
        deductionRates: .init(centsPerKm: 88, centsPerHour: 70), estimate: household,
        baseline: nil, memberExtras: [])
    static let shareJSON = """
        [{"household_id":"h","financial_year":2027,"recipient_email":"agent@example.com",\
        "expires_at":"2026-12-08T00:00:00Z","created_at":"2026-12-01T00:00:00Z"}]
        """
}

@MainActor
@Suite struct TaxViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [:]
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
                    let name = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(name)
                    let failed = server.failing.contains(name)
                    let fallback = request.url!.path.contains("/functions/")
                        ? #"{"token":"abc","expiresAt":"2026-12-08T00:00:00Z","emailSent":true}"#
                        : "[]"
                    return (
                        Data((failed ? "{}" : server.bodies[name] ?? fallback).utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("TaxViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData, mode: TaxViewModel.Mode = .tax) -> TaxViewModel {
        TaxViewModel(
            mode: mode, data: data,
            engine: TaxEngine(screen: { _ in TaxFixtures.figures }),
            now: { Date(timeIntervalSince1970: 1_796_000_000) },
            planning: PlanningStore(defaults: UserDefaults(suiteName: UUID().uuidString)!))
    }

    @Test func taxReadsTheEstimateTablesForTheCurrentYear() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.figures == TaxFixtures.figures)
        #expect(model.financialYear == 2027)
        #expect(
            Set(server.paths)
                == [
                    "members", "inflows", "tax_profile", "super_contribution", "super_profile",
                    "help_debt", "deduction", "payslip", "savings_goal", "accounts_with_balance",
                    "trade", "equity_grant", "equity_exercise", "equity_sale",
                ])
    }

    @Test func eofyAlsoReadsGroupsReceiptsAndTheShare() async {
        let server = Server()
        server.bodies["share_grant"] = TaxFixtures.shareJSON
        let model = model(makeData(server, directory: directory()), mode: .eofy)
        await model.load()
        #expect(model.state.value?.rows.shareGrants.map(\.recipientEmail) == ["agent@example.com"])
        #expect(Set(server.paths).isSuperset(of: ["deduction_group", "deduction_receipt"]))
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["trade"]
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
        #expect(content.figures == TaxFixtures.figures)
        #expect(error?.code == .server)
    }

    @Test func creatingAShareReturnsItsTokenOnce() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()), mode: .eofy)
        let created = try await model.createShare(financialYear: 2027, recipientEmail: "a@b.co")
        #expect(created == CreatedShare(token: "abc", expiresAt: "2026-12-08T00:00:00Z", emailSent: true))
        #expect(server.paths.contains("share-create"))
    }

    @Test func revokingAShareCallsTheFunction() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()), mode: .eofy)
        try await model.revokeShare()
        #expect(server.paths.contains("revoke_share_grant"))
    }
}
