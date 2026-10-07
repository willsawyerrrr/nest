import Foundation
import Testing

@testable import Nest

private func summary(
    hasPayAccount: Bool = true,
    splits: [(String, Int)] = [],
    stays: [(String, Int)] = [],
    unassigned: Int = 0
) -> PaySplitSummary {
    func accounts(_ pairs: [(String, Int)]) -> [PaySplitAccount] {
        pairs.map { PaySplitAccount(accountId: $0.0, name: $0.0, fortnightlyCents: $0.1) }
    }
    let splitAccounts = accounts(splits)
    return PaySplitSummary(
        hasPayAccount: hasPayAccount,
        splits: splitAccounts,
        totalCents: splitAccounts.reduce(0) { $0 + $1.fortnightlyCents },
        stays: accounts(stays),
        unassignedFortnightlyCents: unassigned
    )
}

@Suite struct PaySplitPhrasingTests {
    @Test func speaksASingleSplitWithoutATotal() {
        let sentence = PaySplitPhrasing.spokenSummary(summary(splits: [("Japan", 400_00)]))

        #expect(sentence == "Each fortnight, send $400.00 to Japan.")
    }

    @Test func listsSeveralSplitsWithTheirTotal() {
        let sentence = PaySplitPhrasing.spokenSummary(
            summary(splits: [("Japan", 400_00), ("Bills", 150_00), ("Holiday", 50_00)])
        )

        #expect(
            sentence
                == "Each fortnight, send $400.00 to Japan, $150.00 to Bills and $50.00 to Holiday, "
                + "$600.00 in total."
        )
    }

    @Test func namesTwoSplitsWithAnd() {
        let sentence = PaySplitPhrasing.spokenSummary(
            summary(splits: [("Japan", 400_00), ("Bills", 150_00)])
        )

        #expect(
            sentence
                == "Each fortnight, send $400.00 to Japan and $150.00 to Bills, $550.00 in total."
        )
    }

    @Test func mentionsUnroutedBudget() {
        let sentence = PaySplitPhrasing.spokenSummary(
            summary(splits: [("Japan", 400_00)], unassigned: 50_00)
        )

        #expect(
            sentence
                == "Each fortnight, send $400.00 to Japan. $50.00 more isn't routed to an account yet."
        )
    }

    @Test func promptsSetupWhenNothingIsRouted() {
        #expect(
            PaySplitPhrasing.spokenSummary(summary())
                == "You haven't set up a pay split yet. Route your budget items to accounts in Nest."
        )
        #expect(
            PaySplitPhrasing.spokenSummary(summary(unassigned: 50_00)).hasPrefix(
                "None of your budget is routed to an account yet"
            )
        )
    }

    @Test func promptsForAPayAccountWhenOnlySpendingAccountsAreRouted() {
        let sentence = PaySplitPhrasing.spokenSummary(
            summary(hasPayAccount: false, stays: [("Bills", 200_00)])
        )

        #expect(sentence == "Choose the account your pay lands in, in Nest, to see your pay split.")
    }

    @Test func saysNothingNeedsTransferringWhenEverythingStays() {
        let sentence = PaySplitPhrasing.spokenSummary(summary(stays: [("Spending", 200_00)]))

        #expect(sentence == "Everything stays in your pay account, so there's nothing to transfer.")
    }
}

@Suite struct PaySplitServiceTests {
    private final class RequestBox: @unchecked Sendable {
        var request: URLRequest?
    }

    private let body = """
        {"hasPayAccount":true,"splits":[{"accountId":"a1","name":"Japan","fortnightlyCents":40000}],\
        "totalCents":40000,"stays":[],"unassignedFortnightlyCents":0}
        """

    private func response(_ status: Int, url: URL) -> URLResponse {
        HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
    }

    @Test func postsTheAccessTokenAndAnonKeyToPaySplit() async throws {
        let box = RequestBox()
        let service = PaySplitService { request in
            box.request = request
            return (Data(self.body.utf8), self.response(200, url: request.url!))
        }

        let decoded = try await service.summary(accessToken: "the-token")

        let request = try #require(box.request)
        #expect(
            request.url == SupabaseConfig.url.appendingPathComponent("functions/v1/pay-split")
        )
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer the-token")
        #expect(request.value(forHTTPHeaderField: "apikey") == SupabaseConfig.anonKey)
        #expect(request.httpBody == Data("{}".utf8))
        #expect(decoded.splits == [PaySplitAccount(accountId: "a1", name: "Japan", fortnightlyCents: 40000)])
        #expect(decoded.totalCents == 40000)
    }

    @Test func throwsHTTPForANon2xxStatus() async {
        let service = PaySplitService { request in
            (Data(), self.response(500, url: request.url!))
        }

        await #expect {
            _ = try await service.summary(accessToken: "t")
        } throws: { error in
            guard case PaySplitServiceError.http(let status) = error else { return false }
            return status == 500
        }
    }
}

@Suite struct PaySplitResponseTests {
    private func service(returning json: String) -> PaySplitService {
        PaySplitService { request in
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

        let outcome = await paySplitResponse(
            accessToken: { throw NoSession() },
            service: service(returning: "{}")
        )

        #expect(outcome.sentence == "Open Nest and sign in to check your pay split.")
        #expect(outcome.splits.isEmpty)
    }

    @Test func asksTheMemberToSignInOnA401() async {
        let outcome = await paySplitResponse(
            accessToken: { "expired" },
            service: PaySplitService { _ in throw PaySplitServiceError.http(status: 401) }
        )

        #expect(outcome.sentence == "Open Nest and sign in to check your pay split.")
    }

    @Test func returnsTheSentenceAndSplitsWhenTheServiceAnswers() async {
        let outcome = await paySplitResponse(
            accessToken: { "token" },
            service: service(
                returning: """
                    {"hasPayAccount":true,"splits":[{"accountId":"a1","name":"Japan","fortnightlyCents":40000}],\
                    "totalCents":40000,"stays":[],"unassignedFortnightlyCents":0}
                    """
            )
        )

        #expect(outcome.sentence == "Each fortnight, send $400.00 to Japan.")
        #expect(outcome.splits.map(\.accountId) == ["a1"])
    }

    @Test func fallsBackToTryAgainOnAnyOtherFailure() async {
        let outcome = await paySplitResponse(
            accessToken: { "token" },
            service: PaySplitService { _ in throw PaySplitServiceError.http(status: 503) }
        )

        #expect(outcome.sentence == "Couldn't reach Nest just now. Try again in a moment.")
        #expect(outcome.splits.isEmpty)
    }
}

@Suite struct PaySplitEntityTests {
    @Test func carriesTheAccountAndDollarAmount() {
        let entity = PaySplitEntity(
            PaySplitAccount(accountId: "a1", name: "Japan", fortnightlyCents: 40050)
        )

        #expect(entity.id == "a1")
        #expect(entity.name == "Japan")
        #expect(entity.fortnightlyAmount == 400.50)
    }
}
