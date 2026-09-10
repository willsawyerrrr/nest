import Foundation
import Testing

@testable import Nest

@Suite struct BufferServiceTests {
    /// Captures the request the service sends, across the `@Sendable` transport boundary.
    private final class RequestBox: @unchecked Sendable {
        var request: URLRequest?
    }

    /// A 200 response carrying `body`, for the URL the request asked for.
    private func ok(_ body: String, url: URL) -> (Data, URLResponse) {
        (
            Data(body.utf8),
            HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
        )
    }

    @Test func postsTheAccessTokenAndAnonKeyToIntentSummary() async throws {
        let box = RequestBox()
        let service = BufferService { request in
            box.request = request
            return self.ok(#"{"fortnightlyAfterSavingCents":123}"#, url: request.url!)
        }

        _ = try await service.fortnightlyAfterSavingCents(accessToken: "the-token")

        let request = try #require(box.request)
        #expect(
            request.url
                == SupabaseConfig.url.appendingPathComponent("functions/v1/intent-summary")
        )
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer the-token")
        #expect(request.value(forHTTPHeaderField: "apikey") == SupabaseConfig.anonKey)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.httpBody == Data("{}".utf8))
    }

    @Test func returnsTheDecodedCentsFigure() async throws {
        let service = BufferService { request in
            self.ok(#"{"fortnightlyAfterSavingCents":-4200}"#, url: request.url!)
        }

        let cents = try await service.fortnightlyAfterSavingCents(accessToken: "t")

        #expect(cents == -4200)
    }

    @Test func throwsHTTPForANon2xxStatus() async {
        let service = BufferService { request in
            (
                Data(),
                HTTPURLResponse(
                    url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil
                )!
            )
        }

        await #expect {
            _ = try await service.fortnightlyAfterSavingCents(accessToken: "t")
        } throws: { error in
            guard case BufferServiceError.http(let status) = error else { return false }
            return status == 401
        }
    }

    @Test func propagatesADecodingFailureOnAMalformedBody() async {
        let service = BufferService { request in
            self.ok("not json", url: request.url!)
        }

        await #expect(throws: (any Error).self) {
            _ = try await service.fortnightlyAfterSavingCents(accessToken: "t")
        }
    }
}
