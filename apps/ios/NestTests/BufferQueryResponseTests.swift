import Foundation
import Testing

@testable import Nest

@Suite struct BufferQueryResponseTests {
    /// A service whose single call returns `cents`.
    private func service(returning cents: Int) -> BufferService {
        BufferService { request in
            (
                Data(#"{"fortnightlyAfterSavingCents":\#(cents)}"#.utf8),
                HTTPURLResponse(
                    url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil
                )!
            )
        }
    }

    /// A service whose single call throws `error`.
    private func service(throwing error: Error) -> BufferService {
        BufferService { _ in throw error }
    }

    @Test func asksTheMemberToSignInWhenThereIsNoSession() async {
        struct NoSession: Error {}

        let sentence = await bufferQuerySpokenResponse(
            accessToken: { throw NoSession() },
            service: service(returning: 0)
        )

        #expect(sentence == "Open Nest and sign in to check your buffer.")
    }

    @Test func speaksTheBufferWhenTheServiceAnswers() async {
        let sentence = await bufferQuerySpokenResponse(
            accessToken: { "token" },
            service: service(returning: 500_00)
        )

        #expect(sentence == "Your fortnightly buffer is $500.00 after saving.")
    }

    @Test func asksTheMemberToSignInOnA401() async {
        let sentence = await bufferQuerySpokenResponse(
            accessToken: { "expired" },
            service: service(throwing: BufferServiceError.http(status: 401))
        )

        #expect(sentence == "Open Nest and sign in to check your buffer.")
    }

    @Test func fallsBackToTryAgainOnAnyOtherServiceFailure() async {
        let sentence = await bufferQuerySpokenResponse(
            accessToken: { "token" },
            service: service(throwing: BufferServiceError.http(status: 503))
        )

        #expect(sentence == "Couldn't reach Nest just now. Try again in a moment.")
    }
}
