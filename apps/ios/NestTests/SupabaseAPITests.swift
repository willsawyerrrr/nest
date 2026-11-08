import Foundation
import Testing

@testable import Nest

@Suite struct SupabaseAPITests {
    /// Captures the requests sent across the `@Sendable` transport boundary.
    private final class RequestBox: @unchecked Sendable {
        var requests: [URLRequest] = []
        var last: URLRequest? { requests.last }
    }

    private let base = URL(string: "https://example.supabase.co")!

    private func api(
        status: Int = 200, body: String = "[]", box: RequestBox = RequestBox(),
        token: @escaping @Sendable () async throws -> String = { "tok" }
    ) -> SupabaseAPI {
        SupabaseAPI(
            baseURL: base, anonKey: "anon", accessToken: token,
            send: { request in
                box.requests.append(request)
                return (
                    Data(body.utf8),
                    HTTPURLResponse(
                        url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
                )
            })
    }

    private func query(_ request: URLRequest?) -> [String: String] {
        let items =
            URLComponents(url: request!.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    }

    private let goal = """
        [{"id":"g1","household_id":"h1","name":"Japan","target_amount_cents":1000000,\
        "current_balance_cents":420000,"annual_interest_bps":null,"linked_account_id":null,\
        "planned_contribution_cents":null,"queue_position":1,"target_date":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}]
        """

    @Test func selectSendsBearerAnonKeyAndQuery() async throws {
        let box = RequestBox()
        let rows = try await api(body: goal, box: box).select(
            SavingsGoal.self, filters: [.eq("household_id", "h1"), .isNull("target_date")],
            order: [Order(column: "queue_position"), Order(column: "name", ascending: false)],
            limit: 5
        )

        let request = try #require(box.last)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/rest/v1/savings_goal")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        #expect(request.value(forHTTPHeaderField: "apikey") == "anon")
        let q = query(request)
        #expect(q["select"] == "*")
        #expect(q["household_id"] == "eq.h1")
        #expect(q["target_date"] == "is.null")
        #expect(q["order"] == "queue_position.asc,name.desc")
        #expect(q["limit"] == "5")
        #expect(rows.first?.name == "Japan")
        #expect(rows.first?.targetAmountCents == 1_000_000)
    }

    @Test func insertPostsJSONAndAsksForTheRows() async throws {
        let box = RequestBox()
        let rows = try await api(body: goal, box: box).insert(
            SavingsGoal.self, values: ["name": "Japan"])

        let request = try #require(box.last)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Prefer") == "return=representation")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.httpBody == Data(#"{"name":"Japan"}"#.utf8))
        #expect(rows.count == 1)
    }

    @Test func updatePatchesMatchingRows() async throws {
        let box = RequestBox()
        _ = try await api(body: goal, box: box).update(
            SavingsGoal.self, values: ["name": "Tokyo"], filters: [.eq("id", "g1")]
        )

        let request = try #require(box.last)
        #expect(request.httpMethod == "PATCH")
        #expect(query(request)["id"] == "eq.g1")
    }

    @Test func deleteSendsFiltersAndRefusesNone() async throws {
        let box = RequestBox()
        try await api(box: box).delete(SavingsGoal.self, filters: [.in("id", ["a", "b"])])
        #expect(box.last?.httpMethod == "DELETE")
        #expect(query(box.last)["id"] == "in.(a,b)")

        let before = box.requests.count
        await #expect(throws: NestError(.invalidRequest)) {
            try await api(box: box).delete(SavingsGoal.self, filters: [])
        }
        #expect(box.requests.count == before)
    }

    @Test func rpcPostsParamsAndDecodesTheResult() async throws {
        let box = RequestBox()
        let result: Int = try await api(body: "42", box: box).rpc(
            "reconcile_annual_cents", params: ["x": 1])

        #expect(box.last?.url?.path == "/rest/v1/rpc/reconcile_annual_cents")
        #expect(box.last?.httpBody == Data(#"{"x":1}"#.utf8))
        #expect(result == 42)
    }

    @Test func callIgnoresAnEmptyResponse() async throws {
        let box = RequestBox()
        try await api(body: "", box: box).call("set_member_date_of_birth")
        #expect(box.last?.httpBody == Data("{}".utf8))
    }

    @Test func signedURLResolvesAgainstTheStorageEndpoint() async throws {
        let box = RequestBox()
        let url = try await api(
            body: #"{"signedURL":"/object/sign/receipts/a.pdf?token=t"}"#, box: box
        )
        .signedURL(bucket: "receipts", path: "a.pdf", expiresIn: 60)

        #expect(box.last?.url?.path == "/storage/v1/object/sign/receipts/a.pdf")
        #expect(box.last?.httpBody == Data(#"{"expiresIn":60}"#.utf8))
        #expect(
            url.absoluteString
                == "https://example.supabase.co/storage/v1/object/sign/receipts/a.pdf?token=t")
    }

    @Test func invokePostsToTheEdgeFunction() async throws {
        let box = RequestBox()
        let result: [String: Int] = try await api(body: #"{"a":1}"#, box: box).invoke(
            "goal-progress")

        #expect(box.last?.url?.path == "/functions/v1/goal-progress")
        #expect(result == ["a": 1])
    }

    @Test func mapsAnErrorResponseWithoutLeakingItsBody() async {
        let failing = api(status: 403, body: #"{"code":"42501","message":"row violates policy x"}"#)
        await #expect(throws: NestError(.forbidden, status: 403, upstreamCode: "42501")) {
            try await failing.select(SavingsGoal.self)
        }
    }

    @Test func throwsDecodingForAnUnreadableBody() async {
        await #expect(throws: NestError(.decoding)) {
            try await api(body: #"[{"id":1}]"#).select(SavingsGoal.self)
        }
    }

    @Test func throwsUnauthenticatedWithoutSendingWhenThereIsNoToken() async {
        struct NoSession: Error {}
        let box = RequestBox()
        await #expect(throws: NestError(.unauthenticated)) {
            try await api(box: box, token: { throw NoSession() }).select(SavingsGoal.self)
        }
        #expect(box.requests.isEmpty)
    }

    @Test func mapsATransportFailure() async {
        let offline = SupabaseAPI(
            baseURL: base, anonKey: "a", accessToken: { "t" },
            send: { _ in throw URLError(.notConnectedToInternet) })
        await #expect(throws: NestError(.offline)) { try await offline.select(SavingsGoal.self) }
    }
}
