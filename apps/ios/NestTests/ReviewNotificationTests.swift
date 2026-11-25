import Foundation
import Testing

@testable import Nest

@Suite struct ReviewNotificationTests {
    private static let id = "6f1c2a4e-1111-4222-8333-944455556666"

    /// A stub project: answers each request by method and path, recording them.
    private final class Server: @unchecked Sendable {
        private let lock = NSLock()
        private var recorded: [(method: String, path: String, body: [String: Any])] = []
        var transactions = "[]"

        var requests: [(method: String, path: String, body: [String: Any])] {
            lock.withLock { recorded }
        }

        func respond(_ request: URLRequest) -> (Data, URLResponse) {
            let json = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            let path = request.url!.path
            lock.withLock {
                recorded.append((request.httpMethod ?? "GET", path, (json as? [String: Any]) ?? [:]))
            }
            let (status, body): (Int, String) =
                switch path {
                case _ where path.hasSuffix("/transactions"): (200, transactions)
                case _ where path.hasSuffix("/up_category"): (200, Self.categories)
                default: (404, "{}")
                }
            return (
                Data(body.utf8),
                HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            )
        }

        static let categories = """
            [{"id":"home","name":"Home","parent_id":null},\
            {"id":"groceries","name":"Groceries","parent_id":"home"},\
            {"id":"good-life","name":"Good Life","parent_id":null},\
            {"id":"restaurants-and-cafes","name":"Restaurants & Cafes","parent_id":"good-life"}]
            """
    }

    private static func transaction(
        category: String? = "groceries", reviewedAt: String? = nil, flaggedAt: String? = nil
    ) -> String {
        func value(_ text: String?) -> String { text.map { "\"\($0)\"" } ?? "null" }
        return """
            [{"id":"\(id)","household_id":"h","account_id":"a","amount_cents":-4210,\
            "category_id":null,"description":"Myer","external_category":\(value(category)),\
            "external_category_since":"2026-11-21T00:00:00Z","external_parent_category":null,\
            "is_categorizable":true,"transaction_type":null,"deep_link_url":null,\
            "up_message":null,"up_note":null,"performing_customer_name":null,\
            "reviewed_at":\(value(reviewedAt)),"reviewed_by_member_id":null,\
            "category_flagged_wrong_at":\(value(flaggedAt)),"category_flagged_wrong_by_member_id":null,\
            "external_id":null,"kind":"expense","member_id":null,"notes":"kept",\
            "posted_at":"2026-11-21T00:00:00Z","source":"up","status":"settled",\
            "created_at":"2026-11-21T00:00:00Z","updated_at":"2026-11-21T00:00:00Z"}]
            """
    }

    private func loader(_ server: Server) -> ReviewNotificationLoader {
        ReviewNotificationLoader(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" }, send: { server.respond($0) }))
    }

    // MARK: Payload

    @Test func readsAUUIDTransactionIDFromThePayload() {
        #expect(ReviewNotification.transactionID(["transactionId": Self.id.uppercased()]) == Self.id)
        #expect(ReviewNotification.transactionID(["transactionId": "tx-1"]) == nil)
        #expect(ReviewNotification.transactionID(["transactionId": 3]) == nil)
        #expect(ReviewNotification.transactionID([:]) == nil)
    }

    // MARK: Summary

    @Test func readsTheCurrentCategoryAwaitingReview() async throws {
        let server = Server()
        server.transactions = Self.transaction()
        let summary = try await loader(server).summary(transactionID: Self.id)
        #expect(
            summary
                == ReviewNotificationSummary(
                    category: "Home › Groceries", reviewed: false, flaggedWrong: false))
        #expect(server.requests.allSatisfy { $0.method == "GET" })
    }

    @Test func labelsAnUncategorisedTransaction() async throws {
        let server = Server()
        server.transactions = Self.transaction(category: nil)
        #expect(try await loader(server).summary(transactionID: Self.id).category == "Uncategorised")
    }

    @Test func readsAFlaggedCategory() async throws {
        let server = Server()
        server.transactions = Self.transaction(flaggedAt: "2026-11-21T01:00:00Z")
        let summary = try await loader(server).summary(transactionID: Self.id)
        #expect(summary.flaggedWrong && !summary.reviewed)
    }

    @Test func aReviewedTransactionIsNotFlagged() async throws {
        let server = Server()
        server.transactions = Self.transaction(
            reviewedAt: "2026-11-21T02:00:00Z", flaggedAt: "2026-11-21T01:00:00Z")
        let summary = try await loader(server).summary(transactionID: Self.id)
        #expect(summary.reviewed && !summary.flaggedWrong)
    }

    @Test func aTransactionTheMemberCannotSeeIsNotFound() async {
        await #expect(throws: NestError(.notFound)) {
            try await loader(Server()).summary(transactionID: Self.id)
        }
    }

    // MARK: Model

    @MainActor @Test func loadsTheSummary() async {
        let server = Server()
        server.transactions = Self.transaction()
        let model = ReviewNotificationModel(loader: loader(server))
        await model.load(transactionID: Self.id)
        #expect(
            model.state
                == .loaded(
                    ReviewNotificationSummary(
                        category: "Home › Groceries", reviewed: false, flaggedWrong: false)))
    }

    @MainActor @Test func aPayloadWithNoTransactionFailsToLoad() async {
        let server = Server()
        let model = ReviewNotificationModel(loader: loader(server))
        await model.load(transactionID: nil)
        #expect(model.state == .failed(message: "Nest can no longer find this transaction."))
        #expect(server.requests.isEmpty)
    }

    @MainActor @Test func aSignedOutMemberIsAskedToOpenNest() async {
        let model = ReviewNotificationModel(
            loader: ReviewNotificationLoader(
                api: SupabaseAPI(
                    baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                    accessToken: { throw NestError(.unauthenticated) },
                    send: { _ in throw URLError(.badURL) })))
        await model.load(transactionID: Self.id)
        #expect(model.state == .failed(message: "Open Nest to sign in, then try again."))
    }
}
