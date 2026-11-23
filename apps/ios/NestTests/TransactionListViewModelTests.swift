import Foundation
import Testing

@testable import Nest

@MainActor
@Suite struct TransactionListViewModelTests {
    private final class Server: @unchecked Sendable {
        /// The transactions each request answers, chosen by its `offset`.
        var pages: [Int: String] = [0: "[\(ReviewFixtures.transaction("t1"))]"]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(path: String, query: String, body: [String: Any])] = []
        var requests: [(path: String, query: String, body: [String: Any])] {
            lock.withLock { recorded }
        }

        func respond(_ request: URLRequest) -> (Int, String) {
            let path = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)
            let query = components?.percentEncodedQuery?.removingPercentEncoding ?? ""
            let json = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            lock.withLock { recorded.append((path, query, (json as? [String: Any]) ?? [:])) }
            if failing.contains(path) { return (500, "{}") }
            switch path {
            case "transactions":
                let offset = components?.queryItems?.first { $0.name == "offset" }?.value
                return (200, pages[offset.flatMap(Int.init) ?? 0] ?? "[]")
            case "up_category": return (200, ReviewFixtures.categories)
            case "account_directory": return (200, ReviewFixtures.accounts)
            case "members":
                return (
                    200,
                    """
                    [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
                    "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\(ReviewFixtures.stamp)}]
                    """
                )
            case "up-categorise", "review_transaction": return (200, "{}")
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
                    .appendingPathComponent("TransactionListTests-\(UUID().uuidString)")),
            userID: { "u" })
    }

    private var sydney: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return calendar
    }

    private func page(_ ids: Range<Int>) -> String {
        "[" + ids.map { ReviewFixtures.transaction("t\($0)") }.joined(separator: ",") + "]"
    }

    @Test func loadsEveryVisibleTransactionNewestFirstAFullPageAtATime() async throws {
        let server = Server()
        let model = TransactionListViewModel(data: makeData(server), calendar: sydney)
        await model.load()

        let presentation = try #require(model.state.value)
        #expect(presentation.rows.map(\.id) == ["t1"])
        #expect(presentation.rows.first?.review.meta == "Spending · 20 Nov 2026")
        #expect(presentation.rows.first?.attribution == "Joint")
        #expect(!presentation.hasMore)
        let list = try #require(server.requests.first { $0.path == "transactions" })
        #expect(list.query.contains("order=posted_at.desc,id.desc"))
        #expect(list.query.contains("limit=50"))
        #expect(!list.query.contains("source="))
        #expect(!list.query.contains("reviewed_at"))
    }

    @Test func filtersNarrowTheReadServerSide() async throws {
        let server = Server()
        let model = TransactionListViewModel(data: makeData(server), calendar: sydney)
        model.filters = TransactionFilters(
            account: "a1", from: "2026-11-01", to: "2026-11-20", kind: "expense",
            status: "pending", category: "good-life")
        await model.load()

        let query = try #require(server.requests.first { $0.path == "transactions" }?.query)
        #expect(query.contains("account_id=eq.a1"))
        #expect(query.contains("posted_at=gte.2026-10-31T13:00:00.000Z"))
        #expect(query.contains("posted_at=lt.2026-11-20T13:00:00.000Z"))
        #expect(query.contains("kind=eq.expense"))
        #expect(query.contains("status=eq.pending"))
        #expect(
            query.contains("or=(external_category.eq.good-life,external_parent_category.eq.good-life)"))
    }

    @Test func uncategorisedMatchesRowsWithNoCategory() async throws {
        let server = Server()
        let model = TransactionListViewModel(data: makeData(server))
        model.filters.category = TransactionFilters.uncategorised
        await model.load()
        let query = try #require(server.requests.first { $0.path == "transactions" }?.query)
        #expect(query.contains("external_category=is.null"))
    }

    @Test func loadMoreAppendsTheNextPageAndReloadsEveryShownPage() async throws {
        let server = Server()
        server.pages = [0: page(0..<50), 50: page(50..<53)]
        let model = TransactionListViewModel(data: makeData(server))
        await model.load()
        #expect(model.state.value?.hasMore == true)

        await model.loadMore()

        let presentation = try #require(model.state.value)
        #expect(presentation.rows.count == 53)
        #expect(presentation.rows.last?.id == "t52")
        #expect(!presentation.hasMore)
        #expect(server.requests.contains { $0.query.contains("offset=50") && $0.query.contains("limit=50") })

        _ = await model.review(transactionID: "t1", note: "")
        #expect(server.requests.last { $0.path == "transactions" }?.query.contains("limit=100") == true)
    }

    @Test func changingTheFiltersStartsOverAtTheFirstPage() async throws {
        let server = Server()
        server.pages = [0: page(0..<50), 50: page(50..<51)]
        let model = TransactionListViewModel(data: makeData(server))
        await model.load()
        await model.loadMore()

        model.filters.kind = "income"
        await model.load()

        let query = try #require(server.requests.last { $0.path == "transactions" }?.query)
        #expect(query.contains("limit=50"))
        #expect(query.contains("kind=eq.income"))
    }

    @Test func aFailedLoadMoreKeepsTheRowsAndSaysSo() async throws {
        let server = Server()
        server.pages = [0: page(0..<50)]
        let model = TransactionListViewModel(data: makeData(server))
        await model.load()
        server.failing = ["transactions"]

        await model.loadMore()

        #expect(model.state.value?.rows.count == 50)
        #expect(model.loadMoreError?.code == .server)
    }

    @Test func aFailureWithNothingShownIsFailed() async {
        let server = Server()
        server.failing = ["members"]
        let model = TransactionListViewModel(data: makeData(server))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheShownRows() async {
        let server = Server()
        let model = TransactionListViewModel(data: makeData(server))
        await model.load()
        server.failing = ["transactions"]
        await model.load()
        guard case .loaded(let presentation, _, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(presentation.rows.count == 1)
        #expect(error?.code == .server)
    }

    @Test func aReviewSavesThroughTheReviewWritesAndReloads() async throws {
        let server = Server()
        let model = TransactionListViewModel(data: makeData(server))
        await model.load()

        let outcome = await model.review(
            transactionID: "t1", note: "Dinner", category: .set("gifts-and-charity"))

        #expect(outcome == .saved)
        let paths = server.requests.map(\.path)
        let categorise = try #require(paths.firstIndex(of: "up-categorise"))
        let review = try #require(paths.firstIndex(of: "review_transaction"))
        #expect(categorise < review)
        #expect(paths[review...].contains("transactions"))
        let body = try #require(server.requests.first { $0.path == "review_transaction" }?.body)
        #expect(body["p_note"] as? String == "Dinner")
    }
}
