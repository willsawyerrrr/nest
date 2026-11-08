import Foundation
import Testing

@testable import Nest

@Suite struct NestErrorTests {
    private func code(_ status: Int, _ body: String = "") -> NestError.Code {
        NestError.response(status: status, body: Data(body.utf8)).code
    }

    @Test func mapsHTTPStatuses() {
        #expect(code(401) == .unauthenticated)
        #expect(code(403) == .forbidden)
        #expect(code(404) == .notFound)
        #expect(code(409) == .conflict)
        #expect(code(400) == .invalidRequest)
        #expect(code(422) == .invalidRequest)
        #expect(code(429) == .rateLimited)
        #expect(code(504) == .timeout)
        #expect(code(500) == .server)
        #expect(code(503) == .server)
    }

    @Test func upstreamCodeRefinesTheStatus() {
        #expect(code(400, #"{"code":"PGRST301","message":"JWT expired"}"#) == .unauthenticated)
        #expect(code(403, #"{"code":"42501","message":"denied"}"#) == .forbidden)
        #expect(code(400, #"{"code":"23505","message":"duplicate"}"#) == .conflict)
        #expect(code(409, #"{"code":"23503","message":"fk"}"#) == .invalidRequest)
        #expect(code(400, #"{"code":"22P02","message":"bad input"}"#) == .invalidRequest)
    }

    @Test func recordsTheUpstreamCodeButNotItsMessage() {
        let error = NestError.response(
            status: 400, body: Data(#"{"code":"23505","message":"secret detail"}"#.utf8)
        )
        #expect(error.upstreamCode == "23505")
        #expect(error.status == 400)
        #expect(!error.userMessage.contains("secret"))
    }

    @Test func toleratesABodyThatIsNotJSON() {
        #expect(code(500, "<html>Bad gateway</html>") == .server)
        #expect(code(401, "{\"error\":\"nope\"}") == .unauthenticated)
    }

    @Test func mapsTransportAndDecodingErrors() {
        #expect((NestError.from(URLError(.notConnectedToInternet)) as? NestError)?.code == .offline)
        #expect((NestError.from(URLError(.timedOut)) as? NestError)?.code == .timeout)
        #expect(NestError.from(URLError(.cancelled)) is CancellationError)
        #expect(
            (NestError.from(
                DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "x")))
                as? NestError)?.code == .decoding
        )
        #expect((NestError.from(NestError(.forbidden)) as? NestError)?.code == .forbidden)
        #expect((NestError.from(NSError(domain: "x", code: 1)) as? NestError)?.code == .unknown)
    }

    @Test func everyCodeHasFixedNonEmptyCopy() {
        let messages = NestError.Code.allCases.map { NestError($0).userMessage }
        #expect(messages.allSatisfy { !$0.isEmpty })
        #expect(Set(messages).count == messages.count)
    }

    @Test func rawValuesAreStable() {
        #expect(NestError.Code.notFound.rawValue == "not_found")
        #expect(NestError.Code.invalidRequest.rawValue == "invalid_request")
        #expect(NestError.Code.rateLimited.rawValue == "rate_limited")
    }
}
