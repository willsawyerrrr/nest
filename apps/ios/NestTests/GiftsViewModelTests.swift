import Foundation
import Testing

@testable import Nest

private enum GiftFixtures {
    static let stamp = "\"created_at\":\"2026-01-01T00:00:00Z\",\"updated_at\":\"2026-01-01T00:00:00Z\""

    static func member(_ id: String, user: String) -> String {
        """
        {"id":"\(id)","household_id":"h","user_id":"\(user)","name":"\(id)","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\(stamp)}
        """
    }

    static let recipients = """
        [{"id":"r-mum","household_id":"h","name":"Mum","member_id":null,\(stamp)},\
        {"id":"r-me","household_id":"h","name":"Me","member_id":"m1",\(stamp)}]
        """
    static let occasions = """
        [{"id":"o","household_id":"h","name":"Christmas","occasion_date":"2026-12-25",\(stamp)}]
        """
    static let budgets = """
        [{"id":"b-mum","household_id":"h","recipient_id":"r-mum","occasion_id":"o",\
        "budgeted_amount_cents":10000,"event_date":null,\(stamp)},\
        {"id":"b-me","household_id":"h","recipient_id":"r-me","occasion_id":"o",\
        "budgeted_amount_cents":20000,"event_date":null,\(stamp)}]
        """

    static func purchase(
        _ id: String, cents: Int, budget: String?, recipient: String? = nil,
        transaction: String? = nil
    ) -> String {
        func value(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "null" }
        return """
            {"id":"\(id)","household_id":"h","amount_cents":\(cents),"description":"\(id)",\
            "purchased_on":"2026-02-01","gift_budget_id":\(value(budget)),\
            "gift_discretionary_budget_id":null,"recipient_id":\(value(recipient)),\
            "transaction_id":\(value(transaction)),\(stamp)}
            """
    }

    static func transaction(_ id: String) -> String {
        """
        {"id":"\(id)","household_id":"h","account_id":"a","amount_cents":-500,\
        "category_id":null,"description":"\(id)","external_category":"gifts-and-charity",\
        "external_category_since":"2026-03-01T12:00:00+00:00","external_parent_category":null,\
        "is_categorizable":true,"transaction_type":null,"deep_link_url":null,\
        "up_message":null,"up_note":null,"performing_customer_name":null,\
        "reviewed_at":null,"reviewed_by_member_id":null,\
        "external_id":null,"kind":"expense","member_id":null,"notes":null,\
        "posted_at":"2026-03-01T12:00:00+00:00","source":"up","status":"settled",\(stamp)}
        """
    }
}

@MainActor
@Suite struct GiftsViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "gift_recipient": GiftFixtures.recipients, "gift_occasion": GiftFixtures.occasions,
            "gift_budget": GiftFixtures.budgets,
            "gift_purchase": "[\(GiftFixtures.purchase("p-mum", cents: 4000, budget: "b-mum"))]",
            "members": "[\(GiftFixtures.member("m1", user: "u"))]",
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [String] = []
        private var recordedWrites: [(method: String, table: String, body: [String: Any])] = []
        var paths: [String] { lock.withLock { recorded } }
        var writes: [(method: String, table: String, body: [String: Any])] {
            lock.withLock { recordedWrites }
        }
        func record(_ path: String) { lock.withLock { recorded.append(path) } }
        func record(_ request: URLRequest, table: String) {
            let method = request.httpMethod ?? "GET"
            guard method != "GET" else { return }
            let json = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            let body = (json as? [String: Any]) ?? (json as? [[String: Any]])?.first ?? [:]
            lock.withLock { recordedWrites.append((method, table, body)) }
        }
    }

    private func makeData(
        _ server: Server, directory: URL, user: String = "u"
    ) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(table)
                    server.record(request, table: table)
                    let failed = server.failing.contains(table)
                    return (
                        Data((failed ? "{}" : server.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { user })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("GiftsViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    @Test func loadsEveryTableThenShowsTheRows() async {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        let content = model.state.value
        #expect(content?.rows.budgets.count == 2)
        #expect(content?.currentMemberID == "m1")
        guard case .loaded(_, let isRefreshing, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(!isRefreshing && error == nil)
        #expect(
            Set(server.paths) == [
                "gift_recipient", "gift_occasion", "gift_budget", "gift_purchase",
                "gift_discretionary_budget", "transactions", "gift_transaction_dismissal", "members",
            ])
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["gift_budget"]
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error.code == .server)
    }

    @Test func aFailedRefreshKeepsTheCachedRows() async {
        let server = Server()
        let dir = directory()
        await GiftsViewModel(data: makeData(server, directory: dir)).load()
        // Purchases and transactions are always fetched fresh; the cached tables
        // fill in around them and stay on screen when their own refresh fails.
        server.failing = ["gift_budget"]
        let again = GiftsViewModel(data: makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let content, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.rows.budgets.count == 2)
        #expect(error?.code == .server)
    }

    @Test func aFailedRefreshOfAShownScreenKeepsItsContent() async {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        server.failing = ["gift_budget"]
        await model.load()
        guard case .loaded(let content, _, let error) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.rows.budgets.count == 2)
        #expect(error?.code == .server)
    }

    // MARK: Management writes

    @Test func addsAnExternalRecipientUnlinkedToAnyMember() async throws {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        #expect(await model.createRecipient(name: "Gran"))
        let write = try #require(server.writes.first)
        #expect(write.method == "POST" && write.table == "gift_recipient")
        #expect(write.body["name"] as? String == "Gran")
        #expect(write.body["household_id"] as? String == "h")
        #expect(write.body["member_id"] is NSNull)
    }

    @Test func savesAnOccasionWithAClearedDate() async throws {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        #expect(await model.updateOccasion(id: "o", name: "Xmas", date: nil))
        let write = try #require(server.writes.first)
        #expect(write.method == "PATCH" && write.table == "gift_occasion")
        #expect(write.body["occasion_date"] is NSNull)
    }

    @Test func theRecipientMayEditTheirOwnGiftsAgreedAmount() async throws {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        let presentation = try #require(model.state.value).presentation
        let own = try #require(presentation.budget(id: "b-me"))
        let check = presentation.check(
            GiftBudgetDraft(
                recipientId: own.recipientId, occasionId: own.occasionId,
                budgetedAmountCents: 25000, eventDate: "2026-12-01"),
            editing: own)
        #expect(check.canSubmit && check.eventDate == nil)
        #expect(await model.updateBudget(id: "b-me", check))
        let write = try #require(server.writes.first)
        #expect(write.method == "PATCH" && write.table == "gift_budget")
        #expect(write.body["budgeted_amount_cents"] as? Int == 25000)
        #expect(write.body["event_date"] is NSNull)
        // Still no spend reaches the member for their own gift.
        let row = model.state.value?.presentation.groups(by: .person).first { $0.key == "r-me" }
        #expect(row?.isHidden == true)
    }

    @Test func aDuplicatePairingCannotBeAdded() async throws {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        let presentation = try #require(model.state.value).presentation
        let check = presentation.check(
            GiftBudgetDraft(
                recipientId: "r-mum", occasionId: "o", budgetedAmountCents: 1, eventDate: nil))
        #expect(check.duplicate && !check.canSubmit)
    }

    @Test func aFailedDeleteSurfacesItsMessage() async {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        server.failing = ["gift_occasion"]
        #expect(!(await model.deleteOccasion(id: "o")))
        #expect(model.actionError == "Could not delete this occasion. Please try again.")
    }

    @Test func membersRecipientsAreFixedAndExternalOnesEditable() async throws {
        let server = Server()
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        let presentation = try #require(model.state.value).presentation
        #expect(presentation.memberRecipients.map(\.id) == ["r-me"])
        #expect(presentation.externalRecipients.map(\.id) == ["r-mum"])
        #expect(presentation.memberRecipientName(presentation.memberRecipients[0]) == "m1")
    }

    // MARK: Privacy

    @Test func purchasesForTheMembersOwnGiftNeverReachTheContent() async {
        let server = Server()
        server.bodies["gift_purchase"] = """
            [\(GiftFixtures.purchase("p-mum", cents: 4000, budget: "b-mum")),\
            \(GiftFixtures.purchase("p-me", cents: 9000, budget: "b-me", transaction: "t-me")),\
            \(GiftFixtures.purchase("p-tag", cents: 700, budget: nil, recipient: "r-me"))]
            """
        server.bodies["transactions"] =
            "[\(GiftFixtures.transaction("t-me")),\(GiftFixtures.transaction("t-open"))]"
        server.bodies["gift_transaction_dismissal"] =
            "[{\"id\":\"x\",\"household_id\":\"h\",\"transaction_id\":\"t-me\",\(GiftFixtures.stamp)}]"
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        let content = try! #require(model.state.value)
        #expect(content.rows.purchases.map(\.id) == ["p-mum"])
        #expect(content.rows.transactions.map(\.id) == ["t-open"])
        #expect(content.rows.dismissals.isEmpty)

        let presentation = content.presentation
        #expect(presentation.candidates.map(\.transactionId) == ["t-open"])
        #expect(presentation.dismissed.isEmpty)
        #expect(presentation.adHocPurchases.isEmpty && presentation.unassignedPurchases.isEmpty)
        #expect(presentation.purchases(budgetID: "b-me").isEmpty)
    }

    @Test func aBudgetForTheMembersOwnGiftReportsNoSpendAndShowsBudgetOnly() async {
        let server = Server()
        server.bodies["gift_purchase"] =
            "[\(GiftFixtures.purchase("p-me", cents: 9000, budget: "b-me"))]"
        let model = GiftsViewModel(data: makeData(server, directory: directory()))
        await model.load()
        let presentation = try! #require(model.state.value).presentation
        let rows = presentation.groups(by: .person)
        let own = try! #require(rows.first { $0.key == "r-me" })
        #expect(own.isHidden)
        #expect(own.rows.first?.isHidden == true)
        #expect(own.totals == GiftTotals(budgetedCents: 20000, spentCents: 0, remainingCents: 20000))
        // The total carries no spend either: only the other gift's remains.
        #expect(presentation.overall.spentCents == 0)
        #expect(presentation.linkChoices.map(\.value) == ["r-mum"])
    }

    @Test func giftPurchasesAndTransactionsAreNeverWrittenToTheCache() async throws {
        let server = Server()
        let dir = directory()
        await GiftsViewModel(data: makeData(server, directory: dir)).load()
        let files = (try? FileManager.default.subpathsOfDirectory(atPath: dir.path)) ?? []
        #expect(files.contains { $0.contains("gift_budget__") })
        #expect(!files.contains { $0.contains("gift_purchase__") })
        #expect(!files.contains { $0.contains("transactions__") })
    }

    @Test func theCacheNeverServesAnotherUsersRows() async throws {
        let server = Server()
        let dir = directory()
        await GiftsViewModel(data: makeData(server, directory: dir, user: "alice")).load()
        let bob = makeData(server, directory: dir, user: "bob")
        var cachedSnapshots = 0
        for try await snapshot in bob.rows(GiftBudget.self) where snapshot.isCached {
            cachedSnapshots += 1
        }
        #expect(cachedSnapshots == 0)
    }

    @Test func aSignedOutDeviceHoldsNoGiftRows() async {
        let server = Server()
        let dir = directory()
        let data = makeData(server, directory: dir)
        await GiftsViewModel(data: data).load()
        await data.clearCache()
        #expect(!FileManager.default.fileExists(atPath: dir.path))
    }
}

@Suite struct GiftsPresentationTests {
    private func rows(_ build: (inout GiftsRows) -> Void = { _ in }) throws -> GiftsRows {
        func decode<T: Decodable>(_ json: String) throws -> [T] {
            try JSONDecoder().decode([T].self, from: Data(json.utf8))
        }
        var rows = GiftsRows(
            recipients: try decode(GiftFixtures.recipients),
            occasions: try decode(GiftFixtures.occasions), budgets: try decode(GiftFixtures.budgets),
            members: try decode("[\(GiftFixtures.member("m1", user: "u"))]"))
        build(&rows)
        return rows
    }

    @Test func totalsSumPurchasesAgainstTheirBudget() throws {
        let purchases: [GiftPurchase] = try JSONDecoder().decode(
            [GiftPurchase].self,
            from: Data(
                "[\(GiftFixtures.purchase("a", cents: 2500, budget: "b-mum")),\(GiftFixtures.purchase("b", cents: 12000, budget: "b-mum"))]"
                    .utf8))
        let presentation = GiftsPresentation(
            rows: try rows { $0.purchases = purchases }, currentMemberID: nil)
        let mum = try #require(presentation.groups(by: .person).first { $0.key == "r-mum" })
        #expect(mum.totals.remainingCents == -4500)
        #expect(mum.totals.isOver)
        #expect(mum.totals.progress == 1)
    }

    @Test func progressIsEmptyWithNoBudgetAndNoSpend() {
        #expect(GiftTotals().progress == 0)
        #expect(GiftTotals(budgetedCents: 0, spentCents: 5, remainingCents: -5).progress == 1)
        #expect(GiftTotals(budgetedCents: 200, spentCents: 50, remainingCents: 150).progress == 0.25)
    }

    @Test func formatsLocalDatesAndCandidateLabels() {
        let calendar = Calendar(identifier: .gregorian)
        #expect(GiftsPresentation.localDate("2026-03-01T12:00:00+00:00", calendar: calendar) != "")
        #expect(GiftsPresentation.date("2026-12-25") == "25 Dec 2026")
        let blank = GiftCandidate(
            transactionId: "t", description: "", amountCents: 1, postedOn: "2026-01-01",
            pending: false)
        #expect(blank.title == "Card purchase")
    }

    @Test func parsesTypedDollarsIntoCents() {
        #expect(GiftMoneyInput.cents("12.50") == 1250)
        #expect(GiftMoneyInput.cents("1,234") == 123_400)
        #expect(GiftMoneyInput.cents("") == nil)
        #expect(GiftMoneyInput.cents("abc") == nil)
        #expect(GiftMoneyInput.cents("-3") == nil)
        #expect(GiftMoneyInput.text(cents: 1250) == "12.50")
    }

    @Test func purchaseValuesEncodeNullsExplicitly() throws {
        let values = GiftValues(fields: ["recipient_id": .null, "amount_cents": .cents(5)])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(values))
            as! [String: Any]
        #expect(json["recipient_id"] is NSNull)
        #expect(json["amount_cents"] as? Int == 5)
    }
}
