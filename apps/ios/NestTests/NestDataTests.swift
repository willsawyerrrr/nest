import Foundation
import Testing

@testable import Nest

@Suite struct NestDataTests {
    private final class Server: @unchecked Sendable {
        var requests: [URLRequest] = []
        var status = 200
        var body = "[]"
    }

    private func goal(_ name: String) -> String {
        """
        {"id":"g1","household_id":"h1","name":"\(name)","target_amount_cents":100,\
        "current_balance_cents":0,"annual_interest_bps":null,"linked_account_id":null,\
        "planned_contribution_cents":null,"queue_position":null,"target_date":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
        """
    }

    private func makeData(
        _ server: Server, user: @escaping @Sendable () async throws -> String = { "u" }
    ) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    server.requests.append(request)
                    return (
                        Data(server.body.utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: server.status, httpVersion: nil,
                            headerFields: nil)!
                    )
                }),
            cache: RowCache(
                directory: FileManager.default.temporaryDirectory
                    .appendingPathComponent("NestDataTests-\(UUID().uuidString)", isDirectory: true)
            ),
            userID: user
        )
    }

    private func collect(_ stream: AsyncThrowingStream<Snapshot<SavingsGoal>, Error>) async -> (
        [Snapshot<SavingsGoal>], Error?
    ) {
        var snapshots: [Snapshot<SavingsGoal>] = []
        do { for try await snapshot in stream { snapshots.append(snapshot) } } catch {
            return (snapshots, error)
        }
        return (snapshots, nil)
    }

    @Test func firstReadIsFreshOnly() async {
        let server = Server()
        server.body = "[\(goal("Japan"))]"
        let (snapshots, error) = await collect(makeData(server).rows(SavingsGoal.self))

        #expect(error == nil)
        #expect(snapshots.map(\.isCached) == [false])
        #expect(snapshots.first?.rows.first?.name == "Japan")
    }

    @Test func laterReadYieldsCachedRowsThenFreshOnes() async {
        let server = Server()
        let data = makeData(server)
        server.body = "[\(goal("Japan"))]"
        _ = await collect(data.rows(SavingsGoal.self))

        server.body = "[\(goal("Tokyo"))]"
        let (snapshots, _) = await collect(data.rows(SavingsGoal.self))

        #expect(snapshots.map(\.isCached) == [true, false])
        #expect(snapshots.map { $0.rows.first?.name } == ["Japan", "Tokyo"])

        server.status = 500
        let (replay, _) = await collect(data.rows(SavingsGoal.self))
        #expect(replay.map { $0.rows.first?.name } == ["Tokyo"])
    }

    @Test func failedRefreshKeepsTheCachedSnapshotAndThrowsATypedError() async {
        let server = Server()
        let data = makeData(server)
        server.body = "[\(goal("Japan"))]"
        _ = await collect(data.rows(SavingsGoal.self))

        server.status = 503
        let (snapshots, error) = await collect(data.rows(SavingsGoal.self))

        #expect(snapshots.map(\.isCached) == [true])
        #expect((error as? NestError)?.code == .server)
    }

    @Test func differentQueriesCacheSeparately() async {
        let server = Server()
        let data = makeData(server)
        server.body = "[\(goal("Japan"))]"
        _ = await collect(data.rows(SavingsGoal.self, filters: [.eq("id", "g1")]))

        let (snapshots, _) = await collect(data.rows(SavingsGoal.self, filters: [.eq("id", "g2")]))
        #expect(snapshots.map(\.isCached) == [false])
    }

    @Test func writesInvalidateTheirTableAndTheNamedOthers() async throws {
        let server = Server()
        let data = makeData(server)
        server.body = "[\(goal("Japan"))]"
        _ = await collect(data.rows(SavingsGoal.self))

        _ = try await data.update(
            SavingsGoal.self, values: ["name": "Tokyo"], filters: [.eq("id", "g1")])
        let (afterUpdate, _) = await collect(data.rows(SavingsGoal.self))
        #expect(afterUpdate.map(\.isCached) == [false])

        let key = QueryKey(table: "savings_goal")
        try await data.delete(Member.self, filters: [.eq("id", "m")], also: ["savings_goal"])
        #expect(await data.cache.read(SavingsGoal.self, key: key, user: "u") == nil)
    }

    @Test func aFailedWriteStillInvalidatesAndThrows() async {
        let server = Server()
        let data = makeData(server)
        server.body = "[\(goal("Japan"))]"
        _ = await collect(data.rows(SavingsGoal.self))

        server.status = 500
        await #expect(throws: NestError.self) {
            try await data.insert(SavingsGoal.self, values: ["name": "x"])
        }
        #expect(
            await data.cache.read(SavingsGoal.self, key: QueryKey(table: "savings_goal"), user: "u")
                == nil)
    }

    @Test func rpcInvalidatesTheNamedTables() async throws {
        let server = Server()
        let data = makeData(server)
        server.body = "[\(goal("Japan"))]"
        _ = await collect(data.rows(SavingsGoal.self))

        try await data.call("commit_planning_changes", invalidating: ["savings_goal"])
        #expect(
            await data.cache.read(SavingsGoal.self, key: QueryKey(table: "savings_goal"), user: "u")
                == nil)
    }

    @Test func signedOutReadsFailAsUnauthenticatedWithoutNetwork() async {
        struct NoSession: Error {}
        let server = Server()
        let (snapshots, error) = await collect(
            makeData(server, user: { throw NoSession() }).rows(SavingsGoal.self))

        #expect(snapshots.isEmpty)
        #expect((error as? NestError)?.code == .unauthenticated)
        #expect(server.requests.isEmpty)
    }

    @Test func cacheIsClearedWhenTheSessionEnds() async {
        let server = Server()
        let data = makeData(server)
        server.body = "[\(goal("Japan"))]"
        _ = await collect(data.rows(SavingsGoal.self))

        await data.clearCacheOnSignOut(
            AsyncStream<Bool> { continuation in
                continuation.yield(true)
                continuation.yield(false)
                continuation.finish()
            })

        #expect(
            await data.cache.read(SavingsGoal.self, key: QueryKey(table: "savings_goal"), user: "u")
                == nil)
    }
}
