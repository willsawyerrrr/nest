import Foundation
import Testing

@testable import Nest

@Suite struct GoalServiceTests {
    /// Captures the request the service sends, across the `@Sendable` transport boundary.
    private final class RequestBox: @unchecked Sendable {
        var request: URLRequest?
    }

    private func ok(_ body: String, url: URL) -> (Data, URLResponse) {
        (
            Data(body.utf8),
            HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
    }

    private let body = """
        {"goals":[{"name":"Japan","savedCents":420000,"targetCents":1000000}],\
        "totalSavedCents":420000,"totalTargetCents":1000000}
        """

    @Test func postsTheAccessTokenAndAnonKeyToGoalProgress() async throws {
        let box = RequestBox()
        let service = GoalService { request in
            box.request = request
            return self.ok(self.body, url: request.url!)
        }

        _ = try await service.progress(accessToken: "the-token")

        let request = try #require(box.request)
        #expect(
            request.url
                == SupabaseConfig.url.appendingPathComponent("functions/v1/goal-progress")
        )
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer the-token")
        #expect(request.value(forHTTPHeaderField: "apikey") == SupabaseConfig.anonKey)
        #expect(request.httpBody == Data("{}".utf8))
    }

    @Test func decodesTheGoalsAndTotals() async throws {
        let service = GoalService { request in self.ok(self.body, url: request.url!) }

        let summary = try await service.progress(accessToken: "t")

        #expect(summary.goals.map(\.name) == ["Japan"])
        #expect(summary.goals.first?.savedCents == 420_000)
        #expect(summary.totalTargetCents == 1_000_000)
    }

    @Test func throwsHTTPForANon2xxStatus() async {
        let service = GoalService { request in
            (
                Data(),
                HTTPURLResponse(
                    url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil
                )!
            )
        }

        await #expect {
            _ = try await service.progress(accessToken: "t")
        } throws: { error in
            guard case GoalServiceError.http(let status) = error else { return false }
            return status == 500
        }
    }
}

@Suite struct GoalProgressResponseTests {
    /// A service that answers 200 with `json`.
    private func service(returning json: String) -> GoalService {
        GoalService { request in
            (
                Data(json.utf8),
                HTTPURLResponse(
                    url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
                )!
            )
        }
    }

    @Test func asksTheMemberToSignInWhenThereIsNoSession() async {
        struct NoSession: Error {}

        let sentence = await goalProgressSpokenResponse(
            accessToken: { throw NoSession() },
            service: service(returning: #"{"goals":[],"totalSavedCents":0,"totalTargetCents":0}"#)
        )

        #expect(sentence == "Open Nest and sign in to check your savings goals.")
    }

    @Test func speaksTheSummaryWhenTheServiceAnswers() async {
        let sentence = await goalProgressSpokenResponse(
            accessToken: { "token" },
            service: service(
                returning: """
                    {"goals":[{"name":"Emergency fund","savedCents":300000,"targetCents":1000000}],\
                    "totalSavedCents":300000,"totalTargetCents":1000000}
                    """
            )
        )

        #expect(sentence == "You've saved $3,000.00 of $10,000.00 for Emergency fund.")
    }

    @Test func asksTheMemberToSignInOnA401() async {
        let sentence = await goalProgressSpokenResponse(
            accessToken: { "expired" },
            service: GoalService { _ in throw GoalServiceError.http(status: 401) }
        )

        #expect(sentence == "Open Nest and sign in to check your savings goals.")
    }

    @Test func fallsBackToTryAgainOnAnyOtherFailure() async {
        let sentence = await goalProgressSpokenResponse(
            accessToken: { "token" },
            service: GoalService { _ in throw GoalServiceError.http(status: 503) }
        )

        #expect(sentence == "Couldn't reach Nest just now. Try again in a moment.")
    }
}
