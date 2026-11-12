import Foundation
import Testing

@testable import Nest

@MainActor
@Suite struct NetWorthViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [:]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [String] = []
        private var recordedMethods: [String] = []
        var paths: [String] { lock.withLock { recorded } }
        var methods: [String] { lock.withLock { recordedMethods } }
        func record(_ path: String, _ method: String) {
            lock.withLock {
                recorded.append(path)
                recordedMethods.append(method)
            }
        }
    }

    private static let outcome = NetWorthOutcome(
        breakdown: .init(
            superAccounts: [], otherAccounts: [], excludedAccounts: [], equityHoldings: [],
            liabilities: [], superTotalCents: 0, otherTotalCents: 0, equityTotalCents: 0,
            liabilitiesTotalCents: 0, totalCents: 123),
        projection: [], projectionBaseYear: 2026)

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(table, request.httpMethod ?? "GET")
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
            .appendingPathComponent("NetWorthViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(
        _ data: NestData, defaults: UserDefaults = UserDefaults(suiteName: UUID().uuidString)!,
        compute: @escaping @Sendable (NetWorthInput) async throws -> NetWorthOutcome = { _ in
            NetWorthViewModelTests.outcome
        }
    ) -> NetWorthViewModel {
        NetWorthViewModel(
            data: data, compute: compute, now: { Date(timeIntervalSince1970: 1_796_083_200) },
            defaults: defaults,
            planning: PlanningStore(defaults: UserDefaults(suiteName: UUID().uuidString)!))
    }

    @Test func loadsEveryTableThenShowsTheOutcome() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.outcome == Self.outcome)
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(
            Set(server.paths) == [
                "accounts_with_balance", "members", "super_profile", "super_contribution",
                "tax_profile", "help_debt", "deduction", "inflows", "savings_goal", "budget_line",
                "equity_grant", "equity_exercise", "equity_sale", "trade",
            ])
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

    @Test func aFailedRefreshKeepsTheCachedOutcome() async {
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
        #expect(content.outcome == Self.outcome)
        #expect(error?.code == .server)
    }

    @Test func persistsTheHorizonAndRecomputesOnChange() async {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let first = model(makeData(Server(), directory: directory()), defaults: defaults)
        #expect(first.horizon == .retirement)
        await first.load()
        first.horizon = .tenYears
        try? await Task.sleep(for: .milliseconds(200))
        #expect(first.state.value?.horizon == .tenYears)
        let second = model(makeData(Server(), directory: directory()), defaults: defaults)
        #expect(second.horizon == .tenYears)
    }

    @Test func excludingAnAccountPatchesItAndReloads() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        await model.setExcluded(true, accountID: "a1")
        #expect(server.methods.contains("PATCH"))
        #expect(model.actionError == nil)
        #expect(model.state.value != nil)
    }
}
