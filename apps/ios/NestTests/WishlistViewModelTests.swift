import Foundation
import Testing

@testable import Nest

private enum Wishlist {
    static let itemJSON = """
        [{"id":"w1","household_id":"h","name":"Bike","amount_cents":250000,"member_id":"m1",\
        "note":null,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
    static let memberJSON = """
        [{"id":"m1","household_id":"h","user_id":"u","name":"Alex","email":null,\
        "date_of_birth":null,"up_connected_at":null,"up_sync_failed_at":null,\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """
}

@MainActor
@Suite struct WishlistViewModelTests {
    private final class Server: @unchecked Sendable {
        var bodies: [String: String] = [
            "wishlist_item": Wishlist.itemJSON, "members": Wishlist.memberJSON,
        ]
        var failing: Set<String> = []
        private let lock = NSLock()
        private var recorded: [(method: String, table: String, body: String)] = []
        var requests: [(method: String, table: String, body: String)] { lock.withLock { recorded } }
        func record(_ method: String, _ table: String, _ body: Data?) {
            lock.withLock {
                recorded.append((method, table, body.flatMap { String(data: $0, encoding: .utf8) } ?? ""))
            }
        }
    }

    private func makeData(_ server: Server, directory: URL) -> NestData {
        NestData(
            api: SupabaseAPI(
                baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                accessToken: { "t" },
                send: { request in
                    let table = request.url!.path.split(separator: "/").last.map(String.init) ?? ""
                    server.record(request.httpMethod ?? "", table, request.httpBody)
                    let failed = server.failing.contains(table)
                    return (
                        Data((failed ? "{}" : server.bodies[table] ?? "[]").utf8),
                        HTTPURLResponse(
                            url: request.url!, statusCode: failed ? 500 : 200, httpVersion: nil,
                            headerFields: nil)!)
                }),
            cache: RowCache(directory: directory), userID: { "u" })
    }

    private func directory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("WishlistViewModelTests-\(UUID().uuidString)", isDirectory: true)
    }

    private func model(_ data: NestData) -> WishlistViewModel {
        WishlistViewModel(
            data: data, defaults: UserDefaults(suiteName: "WishlistViewModelTests-\(UUID())")!)
    }

    @Test func loadsItemsAndMembers() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        #expect(model.state.value?.items.map(\.name) == ["Bike"])
        #expect(model.state.value?.members.map(\.name) == ["Alex"])
        #expect(model.state.value?.householdID == "h")
    }

    @Test func aFailureWithNothingCachedIsFailed() async {
        let server = Server()
        server.failing = ["members"]
        let model = model(makeData(server, directory: directory()))
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
        await model(makeData(server, directory: dir)).load()
        server.failing = ["wishlist_item"]
        let again = model(makeData(server, directory: dir))
        await again.load()
        guard case .loaded(let rows, _, let error) = again.state else {
            Issue.record("not loaded")
            return
        }
        #expect(rows.items.map(\.name) == ["Bike"])
        #expect(error?.code == .server)
    }

    @Test func addingInsertsIntoTheHouseholdThenReloads() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        let input = WishlistItemInput(name: "Lamp", amountCents: 8_000, memberID: nil, note: nil)
        try await model.save(input)
        let post = try #require(server.requests.first { $0.method == "POST" })
        #expect(post.table == "wishlist_item")
        #expect(post.body.contains("\"household_id\":\"h\""))
        #expect(post.body.contains("\"member_id\":null"))
        #expect(server.requests.last?.method == "GET")
    }

    @Test func editingPatchesTheRowAndClearsUnsetFields() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        try await model.save(
            WishlistItemInput(name: "Bike", amountCents: 1_00, memberID: nil, note: nil), id: "w1")
        let patch = try #require(server.requests.first { $0.method == "PATCH" })
        #expect(patch.body.contains("\"note\":null") && patch.body.contains("\"member_id\":null"))
    }

    @Test func deletingRemovesTheRow() async throws {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        try await model.remove(id: "w1")
        #expect(server.requests.contains { $0.method == "DELETE" && $0.table == "wishlist_item" })
    }

    @Test func aFailedSaveThrows() async {
        let server = Server()
        let model = model(makeData(server, directory: directory()))
        await model.load()
        server.failing = ["wishlist_item"]
        await #expect(throws: NestError.self) {
            try await model.save(
                WishlistItemInput(name: "x", amountCents: 1, memberID: nil, note: nil), id: "w1")
        }
    }

    @Test func theSortChoicePersists() {
        let defaults = UserDefaults(suiteName: "WishlistSort-\(UUID())")!
        let model = WishlistViewModel(data: makeData(Server(), directory: directory()), defaults: defaults)
        model.sort = WishlistSort(key: .amount, direction: .desc)
        #expect(WishlistSort.stored(in: defaults) == WishlistSort(key: .amount, direction: .desc))
    }
}

@Suite struct WishlistPresentationTests {
    @Test func theFormRequiresANameAndAPositiveAmount() {
        var draft = WishlistDraft()
        #expect(!draft.canSubmit)
        draft.name = "Lamp"
        #expect(!draft.canSubmit)
        draft.amount = "0"
        #expect(!draft.canSubmit)
        draft.amount = "1,234.5"
        #expect(draft.canSubmit)
        #expect(draft.input.amountCents == 123_450)
    }

    @Test func theFormTrimsAndTurnsABlankNoteIntoNil() {
        var draft = WishlistDraft()
        draft.name = "  Lamp "
        draft.amount = "10"
        draft.note = "   "
        #expect(draft.input.name == "Lamp" && draft.input.note == nil)
        draft.note = " warm "
        #expect(draft.input.note == "warm")
    }

    @Test func aUnknownOwnerReadsUnknown() {
        #expect(WishlistPresentation.memberName([], id: "gone") == "Unknown")
    }

    @Test func promotionPathsCarryTheItem() throws {
        let row = WishlistItemRow(
            id: "w", name: "Café & bar", amountCents: 1_200_00, memberID: nil, ownerName: nil, note: nil)
        let path = WishlistPresentation.promotionPath(.goal, row: row)
        let components = try #require(URLComponents(string: path))
        #expect(components.path == "/goals")
        #expect(components.queryItems?.first { $0.name == "promoteName" }?.value == "Café & bar")
        #expect(components.queryItems?.first { $0.name == "promoteAmountCents" }?.value == "120000")
        #expect(WishlistPresentation.promotionPath(.budget, row: row).hasPrefix("/budget?"))
    }
}
