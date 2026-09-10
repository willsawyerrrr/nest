import Foundation
import Testing

@testable import Nest

@Suite struct BudgetLineResponseTests {
    private func service(returning json: String) -> BudgetLineService {
        BudgetLineService { request in
            (
                Data(json.utf8),
                HTTPURLResponse(
                    url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
                )!
            )
        }
    }

    private func service(throwing error: Error) -> BudgetLineService {
        BudgetLineService { _ in throw error }
    }

    @Test func asksTheMemberToSignInWhenThereIsNoSession() async {
        struct NoSession: Error {}

        let sentence = await budgetLineSpokenResponse(
            query: "groceries",
            accessToken: { throw NoSession() },
            service: service(returning: #"{"match":null,"names":[]}"#)
        )

        #expect(sentence == "Open Nest and sign in to check your budget.")
    }

    @Test func speaksTheBudgetWhenTheServiceAnswers() async {
        let sentence = await budgetLineSpokenResponse(
            query: "groceries",
            accessToken: { "token" },
            service: service(
                returning: #"""
                {"match":{"name":"Groceries","amountCents":20000,"frequency":"weekly",
                "intervalCount":null,"fortnightlyCents":40000,"annualCents":1040000},"names":["Groceries"]}
                """#
            )
        )

        #expect(sentence == "You've budgeted $200.00 per week for Groceries.")
    }

    @Test func asksTheMemberToSignInOnA401() async {
        let sentence = await budgetLineSpokenResponse(
            query: "rent",
            accessToken: { "expired" },
            service: service(throwing: BudgetLineServiceError.http(status: 401))
        )

        #expect(sentence == "Open Nest and sign in to check your budget.")
    }

    @Test func fallsBackToTryAgainOnAnyOtherFailure() async {
        let sentence = await budgetLineSpokenResponse(
            query: "rent",
            accessToken: { "token" },
            service: service(throwing: BudgetLineServiceError.http(status: 500))
        )

        #expect(sentence == "Couldn't reach Nest just now. Try again in a moment.")
    }
}
