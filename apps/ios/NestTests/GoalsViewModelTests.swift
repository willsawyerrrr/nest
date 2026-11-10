import Foundation
import Testing

@testable import Nest

@MainActor
@Suite struct GoalsViewModelTests {
    private final class Server: @unchecked Sendable {
        private let lock = NSLock()
        var bodies: [String: String] = [:]
        var failing: Set<String> = []
        private var recorded: [String] = []
        var requests: [String] { lock.withLock { recorded } }
        func record(_ request: String) { lock.withLock { recorded.append(request) } }
    }

    private static let stamp = "2026-01-01T00:00:00Z"
    private static let goalRow = """
        {"id":"g1","household_id":"h","created_at":"\(stamp)","updated_at":"\(stamp)","name":"Car",\
        "target_amount_cents":500000,"current_balance_cents":100000,"target_date":null,\
        "annual_interest_bps":null,"linked_account_id":null,"planned_contribution_cents":null,\
        "queue_position":null}
        """
    private static let member = """
        {"household_id":"h","created_at":"\(stamp)","updated_at":"\(stamp)","id":"m1","name":"Ada",\
        "date_of_birth":null,"email":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "user_id":"u-m1"}
        """

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record("\(request.httpMethod ?? "") \(table)")
                    let failed = server.failing.contains(table)
                    return (
                        Data((failed ? "{}" : server.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u-m1" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("GoalsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func planning() -> PlanningStore {
        PlanningStore(defaults: UserDefaults(suiteName: "GoalsViewModelTests-\(UUID().uuidString)")!)
    }

    private func model(_ data: NestData, planning: PlanningStore? = nil) -> GoalsViewModel {
        GoalsViewModel(
            data: data,
            overview: { input in
                BudgetOverview(
                    lines: input.lines.map { _ in .init(fortnightlyCents: 0, annualCents: 0) },
                    groups: .init(needs: 0, wants: 0, discretionary: 0, savings: 0, investments: 0),
                    allowances: [], temporaryActive: [])
            },
            queue: { input in
                GoalQueueProjection(
                    active: input.active.map { _ in
                        GoalProjection(
                            remainingCents: 0, alreadyMet: true, fortnightsToTarget: nil,
                            projectedCompletionDate: nil, requiredFortnightlyContributionCents: nil)
                    },
                    queued: input.queued.map { _ in
                        QueuedGoalProjection(
                            remainingCents: 400000, alreadyMet: false, fortnightsToTarget: nil,
                            projectedCompletionDate: nil, requiredFortnightlyContributionCents: nil,
                            projectedStartDate: nil)
                    })
            },
            now: { Date(timeIntervalSince1970: 1_796_083_200) }, planning: planning ?? self.planning())
    }

    @Test func loadsEveryTableThenListsTheQueuedGoal() async {
        let server = Server()
        server.bodies["savings_goal"] = "[\(Self.goalRow)]"
        server.bodies["members"] = "[\(Self.member)]"
        let model = model(makeData(server, directory: directory()))
        await model.load()
        guard case .loaded(let content, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(content.householdID == "h")
        #expect(GoalsPresentation(content: content).queued.map(\.name) == ["Car"])
        #expect(
            Set(server.requests) == [
                "GET savings_goal", "GET budget_line", "GET accounts_with_balance", "GET members",
            ])
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

    @Test func aFailedRefreshKeepsTheCachedGoals() async {
        let server = Server()
        server.bodies["savings_goal"] = "[\(Self.goalRow)]"
        let dir = directory()
        await model(makeData(server, directory: dir)).load()
        server.failing = ["budget_line"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.rows.savingsGoals.map(\.id) == ["g1"])
        #expect(error?.code == .server)
    }

    @Test func aRealEditPatchesTheRowThenReloads() async throws {
        let server = Server()
        server.bodies["savings_goal"] = "[\(Self.goalRow)]"
        server.bodies["members"] = "[\(Self.member)]"
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let goal = try #require(model.state.value?.rows.savingsGoals.first)
        try await model.update(id: "g1", input: GoalInput(goal, queuePosition: 3))
        #expect(server.requests.contains("PATCH savings_goal"))
        try await model.remove(id: "g1")
        #expect(server.requests.contains("DELETE savings_goal"))
        try await model.create(GoalDraft().input(queuePosition: nil))
        #expect(server.requests.contains("POST savings_goal"))
    }

    @Test func reorderWritesOnlyTheGoalsThatMoved() async throws {
        let server = Server()
        let second = Self.goalRow.replacingOccurrences(of: "\"g1\"", with: "\"g2\"")
            .replacingOccurrences(of: "\"queue_position\":null", with: "\"queue_position\":1")
        let first = Self.goalRow.replacingOccurrences(
            of: "\"queue_position\":null", with: "\"queue_position\":0")
        server.bodies["savings_goal"] = "[\(first),\(second)]"
        server.bodies["members"] = "[\(Self.member)]"
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let before = server.requests.filter { $0 == "PATCH savings_goal" }.count
        try await model.reorder(["g1", "g2"])
        #expect(server.requests.filter { $0 == "PATCH savings_goal" }.count == before)
        try await model.reorder(["g2", "g1"])
        #expect(server.requests.filter { $0 == "PATCH savings_goal" }.count == before + 2)
    }

    @Test func planningModeKeepsEditsInTheSandbox() async throws {
        let server = Server()
        server.bodies["savings_goal"] = "[\(Self.goalRow)]"
        server.bodies["members"] = "[\(Self.member)]"
        let store = planning()
        let model = model(makeData(server, directory: directory()), planning: store)
        await model.load()
        store.enter()
        try await model.create(GoalDraft(goal: try #require(model.state.value?.rows.savingsGoals.first)).input(queuePosition: nil))
        try await model.update(
            id: "g1",
            input: GoalInput(try #require(model.state.value?.rows.savingsGoals.first), queuePosition: 4))
        try await model.remove(id: "g1")
        #expect(!server.requests.contains { $0.hasPrefix("POST") || $0.hasPrefix("PATCH") || $0.hasPrefix("DELETE") })
        let layer = store.state.layer(.savingsGoal)
        #expect(layer.creates.count == 1)
        #expect(layer.deletes == ["g1"])
    }

    @Test func aFailedUpSyncSaysSo() async {
        let server = Server()
        server.failing = ["up-sync"]
        let model = model(makeData(server, directory: directory()))
        await model.syncFromUp()
        #expect(model.syncError == GoalsViewModel.syncFailure)
        #expect(!model.isSyncing)
    }
}
