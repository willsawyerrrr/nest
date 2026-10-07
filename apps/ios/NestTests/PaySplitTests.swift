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
    @Test func speaksTheAccountsFortnightlyAmount() {
        let sentence = PaySplitPhrasing.spokenAnswer(
            summary(splits: [("japan", 400_00), ("bills", 150_00)]), accountId: "japan", name: "Japan"
        )

        #expect(sentence == "$400.00 goes to japan each fortnight.")
    }

    @Test func saysNothingIsRoutedToAnAccountWithNoSplit() {
        let sentence = PaySplitPhrasing.spokenAnswer(
            summary(splits: [("bills", 150_00)]), accountId: "japan", name: "Japan"
        )

        #expect(
            sentence
                == "Nothing is routed to Japan yet. Set it as a budget item's funding account in Nest."
        )
    }

    @Test func saysThePayAccountReceivesNoTransfer() {
        let sentence = PaySplitPhrasing.spokenAnswer(
            summary(splits: [("bills", 150_00)], stays: [("pay", 200_00)]),
            accountId: "pay", name: "Spending"
        )

        #expect(sentence == "Spending is your pay account, so nothing is transferred to it.")
    }

    @Test func promptsForAPayAccountWhenNoneIsChosen() {
        let sentence = PaySplitPhrasing.spokenAnswer(
            summary(hasPayAccount: false, stays: [("bills", 200_00)]),
            accountId: "japan", name: "Japan"
        )

        #expect(sentence == "Choose the account your pay lands in, in Nest, to see your pay split.")
    }

    @Test func promptsSetupWhenNothingIsRouted() {
        let sentence = PaySplitPhrasing.spokenAnswer(summary(), accountId: "japan", name: "Japan")

        #expect(
            sentence
                == "You haven't set up a pay split yet. Route your budget items to accounts in Nest."
        )
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
    private let json = """
        {"hasPayAccount":true,"splits":[{"accountId":"a1","name":"Japan","fortnightlyCents":40000}],\
        "totalCents":40000,"stays":[],"unassignedFortnightlyCents":0}
        """

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

    private func respond(
        accountId: String = "a1",
        accessToken: @escaping @Sendable () async throws -> String = { "token" },
        service: PaySplitService
    ) async -> PaySplitOutcome {
        await paySplitResponse(
            accountId: accountId, name: "Japan", accessToken: accessToken, service: service
        )
    }

    @Test func asksTheMemberToSignInWhenThereIsNoSession() async {
        struct NoSession: Error {}

        let outcome = await respond(accessToken: { throw NoSession() }, service: service(returning: "{}"))

        #expect(outcome.sentence == "Open Nest and sign in to check your pay split.")
        #expect(outcome.split == nil)
    }

    @Test func asksTheMemberToSignInOnA401() async {
        let outcome = await respond(
            service: PaySplitService { _ in throw PaySplitServiceError.http(status: 401) }
        )

        #expect(outcome.sentence == "Open Nest and sign in to check your pay split.")
    }

    @Test func returnsTheAccountsSentenceAndSplit() async {
        let outcome = await respond(service: service(returning: json))

        #expect(outcome.sentence == "$400.00 goes to Japan each fortnight.")
        #expect(outcome.split?.accountId == "a1")
    }

    @Test func returnsNoSplitForAnAccountWithNothingRouted() async {
        let outcome = await respond(accountId: "other", service: service(returning: json))

        #expect(outcome.sentence.hasPrefix("Nothing is routed to Japan yet."))
        #expect(outcome.split == nil)
    }

    @Test func fallsBackToTryAgainOnAnyOtherFailure() async {
        let outcome = await respond(
            service: PaySplitService { _ in throw PaySplitServiceError.http(status: 503) }
        )

        #expect(outcome.sentence == "Couldn't reach Nest just now. Try again in a moment.")
        #expect(outcome.split == nil)
    }
}

@Suite struct PaySplitLoadTests {
    @Test func foldsAMissingSessionAndAnUnreachableServiceIntoCases() async {
        struct NoSession: Error {}
        let service = PaySplitService { _ in throw PaySplitServiceError.http(status: 500) }

        let signedOut = await paySplitLoad(accessToken: { throw NoSession() }, service: service)
        let unreachable = await paySplitLoad(accessToken: { "t" }, service: service)

        guard case .signedOut = signedOut else { Issue.record("expected signedOut"); return }
        guard case .unreachable = unreachable else { Issue.record("expected unreachable"); return }
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
