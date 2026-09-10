import Foundation
import Testing

@testable import Nest

@Suite struct BudgetLineServiceTests {
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

    @Test func postsTheQueryAccessTokenAndAnonKey() async throws {
        let box = RequestBox()
        let service = BudgetLineService { request in
            box.request = request
            return self.ok(#"{"match":null,"names":[]}"#, url: request.url!)
        }

        _ = try await service.lookUp(query: "groceries", accessToken: "the-token")

        let request = try #require(box.request)
        #expect(
            request.url
                == SupabaseConfig.url.appendingPathComponent("functions/v1/budget-line")
        )
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer the-token")
        #expect(request.value(forHTTPHeaderField: "apikey") == SupabaseConfig.anonKey)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let sent = try JSONDecoder().decode(
            [String: String].self, from: try #require(request.httpBody)
        )
        #expect(sent == ["query": "groceries"])
    }

    @Test func decodesTheMatchAndNames() async throws {
        let service = BudgetLineService { request in
            self.ok(
                #"""
                {"match":{"name":"Groceries","amountCents":20000,"frequency":"weekly",
                "intervalCount":null,"fortnightlyCents":40000,"annualCents":1040000},
                "names":["Groceries","Rent"]}
                """#,
                url: request.url!
            )
        }

        let response = try await service.lookUp(query: "groceries", accessToken: "t")

        #expect(response.match?.name == "Groceries")
        #expect(response.match?.fortnightlyCents == 40000)
        #expect(response.names == ["Groceries", "Rent"])
    }

    @Test func throwsHTTPForANon2xxStatus() async {
        let service = BudgetLineService { request in
            (
                Data(),
                HTTPURLResponse(
                    url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil
                )!
            )
        }

        await #expect {
            _ = try await service.lookUp(query: "x", accessToken: "t")
        } throws: { error in
            guard case BudgetLineServiceError.http(let status) = error else { return false }
            return status == 401
        }
    }
}
