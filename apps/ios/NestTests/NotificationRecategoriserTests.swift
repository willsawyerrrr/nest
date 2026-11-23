import Foundation
import Testing

@testable import Nest

@Suite struct NotificationRecategoriserTests {
    private static let id = "6f1c2a4e-1111-4222-8333-944455556666"

    /// A stub project: answers each request by method and path, recording them.
    private final class Server: @unchecked Sendable {
        private let lock = NSLock()
        private var recorded: [(method: String, path: String, body: [String: Any])] = []
        var transactions = "[]"
        var categorise: (Int, String) = (200, "{}")
        var review: (Int, String) = (200, "{}")

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
                case _ where path.hasSuffix("/up-categorise"): categorise
                case _ where path.hasSuffix("/review_transaction"): review
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

    private static func transaction(category: String? = "groceries", categorisable: Bool = true)
        -> String
    {
        let category = category.map { "\"\($0)\"" } ?? "null"
        return """
            [{"id":"\(id)","household_id":"h","account_id":"a","amount_cents":-4210,\
            "category_id":null,"description":"Myer","external_category":\(category),\
            "external_category_since":"2026-11-21T00:00:00Z","external_parent_category":null,\
            "is_categorizable":\(categorisable),"transaction_type":null,"deep_link_url":null,\
            "up_message":null,"up_note":null,"performing_customer_name":null,\
            "reviewed_at":null,"reviewed_by_member_id":null,\
            "external_id":null,"kind":"expense","member_id":null,"notes":"kept",\
            "posted_at":"2026-11-21T00:00:00Z","source":"up","status":"settled",\
            "created_at":"2026-11-21T00:00:00Z","updated_at":"2026-11-21T00:00:00Z"}]
            """
    }

    private func recategoriser(_ server: Server) -> NotificationRecategoriser {
        NotificationRecategoriser(
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

    // MARK: Choices

    @Test func offersUpsCategoriesAndMarksTheCurrentOne() async throws {
        let server = Server()
        server.transactions = Self.transaction()
        let choices = try await recategoriser(server).choices(transactionID: Self.id)
        #expect(choices.groups.map(\.name) == ["Good Life", "Home"])
        #expect(choices.currentID == "groceries")
        #expect(choices.currentLabel == "Home › Groceries")
        #expect(choices.categorisable)
    }

    @Test func labelsAnUncategorisedTransaction() async throws {
        let server = Server()
        server.transactions = Self.transaction(category: nil, categorisable: false)
        let choices = try await recategoriser(server).choices(transactionID: Self.id)
        #expect(choices.currentID == nil)
        #expect(choices.currentLabel == "Uncategorised")
        #expect(!choices.categorisable)
    }

    @Test func aTransactionTheMemberCannotSeeIsNotFound() async {
        await #expect(throws: NestError(.notFound)) {
            try await recategoriser(Server()).choices(transactionID: Self.id)
        }
    }

    // MARK: Saving

    @Test func aNewCategoryIsSetOnUpThenReviewedLeavingTheNote() async throws {
        let server = Server()
        let outcome = await recategoriser(server).review(
            transactionID: Self.id, category: .set("restaurants-and-cafes"))
        #expect(outcome == .saved)
        let paths = server.requests.map(\.path)
        #expect(paths.count == 2)
        #expect(paths[0].hasSuffix("/functions/v1/up-categorise"))
        #expect(paths[1].hasSuffix("/rest/v1/rpc/review_transaction"))
        #expect(server.requests[0].body["transaction_id"] as? String == Self.id)
        #expect(server.requests[0].body["category_id"] as? String == "restaurants-and-cafes")
        #expect(server.requests[1].body["p_transaction_id"] as? String == Self.id)
        #expect(server.requests[1].body["p_note"] == nil)
    }

    @Test func clearingTheCategorySendsAnExplicitNull() async {
        let server = Server()
        _ = await recategoriser(server).review(transactionID: Self.id, category: .set(nil))
        #expect(server.requests[0].body["category_id"] is NSNull)
    }

    @Test func anUnchangedCategoryOnlyReviews() async {
        let server = Server()
        let outcome = await recategoriser(server).review(transactionID: Self.id, category: .unchanged)
        #expect(outcome == .saved)
        #expect(server.requests.map(\.path).allSatisfy { $0.hasSuffix("/review_transaction") })
    }

    @Test func saveFailedLeavesTheTransactionUnreviewed() async {
        let server = Server()
        server.categorise = (500, #"{"code":"save_failed","error":"x"}"#)
        let outcome = await recategoriser(server).review(
            transactionID: Self.id, category: .set("groceries"))
        #expect(outcome == .failed(code: "save_failed"))
        #expect(!server.requests.contains { $0.path.hasSuffix("/review_transaction") })
    }

    @Test func aFailedReviewIsReported() async {
        let server = Server()
        server.review = (500, "{}")
        let outcome = await recategoriser(server).review(transactionID: Self.id, category: .unchanged)
        #expect(outcome == .failed(code: nil))
    }

    // MARK: Model

    @MainActor @Test func pickingAnotherCategorySavesItAndSaysSo() async {
        let server = Server()
        server.transactions = Self.transaction()
        let model = RecategoriseModel(recategoriser: recategoriser(server))
        await model.load(transactionID: Self.id)
        await model.pick("restaurants-and-cafes")
        #expect(model.state == .saved(message: "Moved to Restaurants & Cafes and marked reviewed."))
        #expect(model.isSaved)
        #expect(server.requests.contains { $0.path.hasSuffix("/up-categorise") })
    }

    @MainActor @Test func pickingTheCurrentCategoryOnlyMarksItReviewed() async {
        let server = Server()
        server.transactions = Self.transaction()
        let model = RecategoriseModel(recategoriser: recategoriser(server))
        await model.load(transactionID: Self.id)
        await model.pick("groceries")
        #expect(model.state == .saved(message: "Marked reviewed."))
        #expect(!server.requests.contains { $0.path.hasSuffix("/up-categorise") })
    }

    @MainActor @Test func aFailedPickShowsNestsCopyAndRetryReturnsToThePicker() async throws {
        let server = Server()
        server.transactions = Self.transaction()
        server.categorise = (500, #"{"code":"save_failed","error":"x"}"#)
        let model = RecategoriseModel(recategoriser: recategoriser(server))
        await model.load(transactionID: Self.id)
        guard case .choosing(let choices) = model.state else {
            Issue.record("not choosing: \(model.state)")
            return
        }
        await model.pick(nil)
        #expect(
            model.state
                == .failed(choices, message: "Saved in Up, but Nest couldn't update its copy. Try again."))
        #expect(!model.isSaved)
        await model.retry()
        #expect(model.state == .choosing(choices))
    }

    @MainActor @Test func aPayloadWithNoTransactionFailsToLoad() async {
        let server = Server()
        let model = RecategoriseModel(recategoriser: recategoriser(server))
        await model.load(transactionID: nil)
        #expect(model.state == .failed(nil, message: "Nest can no longer find this transaction."))
        #expect(server.requests.isEmpty)
    }

    @MainActor @Test func aSignedOutMemberIsAskedToOpenNest() async {
        let model = RecategoriseModel(
            recategoriser: NotificationRecategoriser(
                api: SupabaseAPI(
                    baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                    accessToken: { throw NestError(.unauthenticated) },
                    send: { _ in throw URLError(.badURL) })))
        await model.load(transactionID: Self.id)
        #expect(model.state == .failed(nil, message: "Open Nest to sign in, then try again."))
    }
}
