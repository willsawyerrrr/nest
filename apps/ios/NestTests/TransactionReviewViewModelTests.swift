import Foundation
import Testing

@testable import Nest

enum ReviewFixtures {
    static let stamp = "\"created_at\":\"2026-01-01T00:00:00Z\",\"updated_at\":\"2026-01-01T00:00:00Z\""

    static func transaction(
        _ id: String, description: String = "Cafe Lune", category: String? = "restaurants-and-cafes",
        reviewedAt: String? = nil, status: String = "settled"
    ) -> String {
        func value(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
        return """
            {"id":"\(id)","household_id":"h","account_id":"a1","amount_cents":-4250,\
            "category_id":null,"description":"\(description)","external_category":\(value(category)),\
            "external_category_since":"2026-03-01T12:00:00+00:00","external_parent_category":null,\
            "is_categorizable":true,"transaction_type":null,"deep_link_url":"up://transaction/\(id)",\
            "up_message":null,"up_note":"Brunch","performing_customer_name":null,\
            "reviewed_at":\(value(reviewedAt)),"reviewed_by_member_id":null,\
            "external_id":"up-\(id)","kind":"expense","member_id":null,"notes":null,\
            "posted_at":"2026-11-20T02:30:00+00:00","source":"up","status":"\(status)",\(stamp)}
            """
    }

    static let categories = """
        [{"id":"good-life","name":"Good Life","parent_id":null},\
        {"id":"restaurants-and-cafes","name":"Restaurants & Cafes","parent_id":"good-life"},\
        {"id":"gifts-and-charity","name":"Gifts & Charity","parent_id":"good-life"}]
        """
    static let accounts = """
        [{"id":"a1","household_id":"h","name":"💸 Spending","owner_member_id":null,\
        "source":"up","type":"transaction","deleted_from_source_at":null}]
        """
}

@MainActor
@Suite struct TransactionReviewViewModelTests {
    private final class Server: @unchecked Sendable {
        var list = "[\(ReviewFixtures.transaction("t1"))]"
        var focused = "[]"
        var failing: Set<String> = []
        /// A status and body answered by `up-categorise`.
        var categorise: (Int, String) = (200, "{}")
        var reviewStatus = 200
        private let lock = NSLock()
        private var recorded: [(path: String, query: String, body: [String: Any])] = []
        var requests: [(path: String, query: String, body: [String: Any])] {
            lock.withLock { recorded }
        }

        func respond(_ request: URLRequest) -> (Int, String) {
            let path = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
            let query = request.url!.query ?? ""
            let json = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            lock.withLock { recorded.append((path, query, (json as? [String: Any]) ?? [:])) }
            if failing.contains(path) { return (500, "{}") }
            switch path {
            case "transactions": return (200, query.contains("id=eq.") ? focused : list)
            case "up_category": return (200, ReviewFixtures.categories)
            case "account_directory": return (200, ReviewFixtures.accounts)
            case "up-categorise": return categorise
            case "review_transaction": return (reviewStatus, "{}")
            default: return (200, "[]")
            }
        }
    }

    private func makeData(_ server: Server) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let (status, body) = server.respond(request)
                    return (
                        Data(body.utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: status, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(
                directory: FileManager.default.temporaryDirectory
                    .appendingPathComponent("TransactionReviewTests-\(UUID().uuidString)")),
            userID: { "u" })
    }

    private let focusID = "11111111-2222-3333-4444-555555555555"

    @Test func loadsTheUnreviewedCategorisableUpTransactionsNewestFirst() async throws {
        let server = Server()
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()

        let presentation = try #require(model.state.value)
        #expect(presentation.rows.map(\.id) == ["t1"])
        #expect(presentation.rows.first?.meta == "Spending · 20 Nov 2026")
        let list = try #require(server.requests.first { $0.path == "transactions" })
        #expect(list.query.contains("source=eq.up"))
        #expect(list.query.contains("is_categorizable=eq.true"))
        #expect(list.query.contains("reviewed_at=is.null"))
        #expect(list.query.contains("order=posted_at.desc"))
        #expect(list.query.contains("limit=100"))
        #expect(!server.requests.contains { $0.query.contains("id=eq.") })
    }

    @Test func leadsWithTheFocusedTransactionEvenOnceReviewed() async throws {
        let server = Server()
        server.focused = "[\(ReviewFixtures.transaction(focusID, description: "Dymocks", reviewedAt: "2026-11-21T00:00:00Z"))]"
        let model = TransactionReviewViewModel(focusID: focusID, data: makeData(server))
        await model.load()

        let presentation = try #require(model.state.value)
        #expect(presentation.rows.map(\.id) == [focusID, "t1"])
        #expect(presentation.focusedID == focusID)
        #expect(presentation.rows.first?.reviewed == true)
    }

    @Test func ignoresAFocusIdThatIsNotAUUID() async {
        let server = Server()
        let model = TransactionReviewViewModel(focusID: "nope", data: makeData(server))
        await model.load()
        #expect(model.state.value?.focusedID == nil)
        #expect(!server.requests.contains { $0.query.contains("id=eq.") })
    }

    @Test func aFailureWithNothingShownIsFailed() async {
        let server = Server()
        server.failing = ["up_category"]
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheShownRows() async {
        let server = Server()
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()
        server.failing = ["account_directory"]
        await model.load()
        guard case .loaded(let presentation, _, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(presentation.rows.count == 1)
        #expect(error?.code == .server)
    }

    @Test func confirmsWithTheNoteLeavingTheCategoryAlone() async throws {
        let server = Server()
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()

        let outcome = await model.review(transactionID: "t1", note: "Dinner")

        #expect(outcome == .saved)
        #expect(!server.requests.contains { $0.path == "up-categorise" })
        let review = try #require(server.requests.first { $0.path == "review_transaction" })
        #expect(review.body["p_transaction_id"] as? String == "t1")
        #expect(review.body["p_note"] as? String == "Dinner")
    }

    @Test func setsTheCategoryOnUpBeforeRecordingTheReview() async throws {
        let server = Server()
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()

        let outcome = await model.review(
            transactionID: "t1", note: "", category: .set("gifts-and-charity"))

        #expect(outcome == .saved)
        let paths = server.requests.map(\.path)
        let categorise = try #require(paths.firstIndex(of: "up-categorise"))
        let review = try #require(paths.firstIndex(of: "review_transaction"))
        #expect(categorise < review)
        let body = server.requests[categorise].body
        #expect(body["transaction_id"] as? String == "t1")
        #expect(body["category_id"] as? String == "gifts-and-charity")
    }

    @Test func clearsTheCategoryWithAnExplicitNull() async throws {
        let server = Server()
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()

        _ = await model.review(transactionID: "t1", note: "", category: .set(nil))

        let body = try #require(server.requests.first { $0.path == "up-categorise" }?.body)
        #expect(body["category_id"] is NSNull)
    }

    @Test func leavesTheTransactionUnreviewedWhenUpRefusesTheCategory() async {
        let server = Server()
        server.categorise = (429, #"{"code":"up_rate_limited","error":"upstream copy"}"#)
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()

        let outcome = await model.review(transactionID: "t1", note: "", category: .set("x"))

        #expect(outcome == .failed(code: "up_rate_limited"))
        #expect(!server.requests.contains { $0.path == "review_transaction" })
    }

    @Test func leavesTheTransactionUnreviewedWhenUpTookTheCategoryButNestCouldNot() async {
        let server = Server()
        server.categorise = (500, #"{"code":"save_failed","error":"x"}"#)
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()

        let outcome = await model.review(transactionID: "t1", note: "", category: .set("x"))

        #expect(outcome == .failed(code: "save_failed"))
        #expect(!server.requests.contains { $0.path == "review_transaction" })
    }

    @Test func aFailedReviewHasNoCode() async {
        let server = Server()
        server.reviewStatus = 500
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()

        #expect(await model.review(transactionID: "t1", note: "") == .failed(code: nil))
    }

    @Test func reloadsAfterAReview() async {
        let server = Server()
        let model = TransactionReviewViewModel(data: makeData(server))
        await model.load()
        server.list = "[]"

        _ = await model.review(transactionID: "t1", note: "")

        #expect(model.state.value?.rows.isEmpty == true)
    }
}
