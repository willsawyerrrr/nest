import Foundation
import Testing
import UserNotifications

@testable import Nest

@Suite struct NotificationActionsTests {
    private let candidate: [AnyHashable: Any] = [
        "url": "/gifts", "transactionId": "tx-1",
        "aps": ["category": "gift_candidate"],
    ]

    @Test func registersTheGiftCandidateCategoryWithItsTwoActions() throws {
        let category = try #require(NotificationActions.categories.first)
        #expect(NotificationActions.categories.count == 1)
        #expect(category.identifier == "gift_candidate")
        #expect(
            category.actions.map(\.identifier)
                == [NotificationActions.linkGift, NotificationActions.dismissGiftCandidate])
        #expect(category.actions[0].options.contains(.foreground))
        #expect(!category.actions[1].options.contains(.foreground))
        #expect(category.actions[1].options.contains(.authenticationRequired))
    }

    @Test(arguments: [UNNotificationDefaultActionIdentifier, NotificationActions.linkGift])
    func aTapAndTheLinkActionOpenThePayloadDestination(_ action: String) {
        #expect(
            NotificationResponse(actionIdentifier: action, userInfo: candidate)
                == .open(NotificationDestination(route: .gifts)))
    }

    @Test func theDismissActionNamesTheTransaction() {
        #expect(
            NotificationResponse(
                actionIdentifier: NotificationActions.dismissGiftCandidate, userInfo: candidate)
                == .dismissGiftCandidate(transactionID: "tx-1"))
    }

    @Test func theDismissActionNeedsATransactionID() {
        let infos: [[AnyHashable: Any]] = [
            ["url": "/gifts"], ["url": "/gifts", "transactionId": ""],
            ["url": "/gifts", "transactionId": 3],
        ]
        for info in infos {
            #expect(
                NotificationResponse(
                    actionIdentifier: NotificationActions.dismissGiftCandidate, userInfo: info)
                    == .ignore)
        }
    }

    @Test func ignoresDismissalAndUnknownActionsAndUnroutablePayloads() {
        #expect(
            NotificationResponse(
                actionIdentifier: UNNotificationDismissActionIdentifier, userInfo: candidate)
                == .ignore)
        #expect(NotificationResponse(actionIdentifier: "other", userInfo: candidate) == .ignore)
        #expect(
            NotificationResponse(
                actionIdentifier: UNNotificationDefaultActionIdentifier, userInfo: [:]) == .ignore)
    }

    @Test func everyScreenShortcutOpensANativeRoute() {
        for screen in ScreenShortcut.allCases {
            guard case .native = screen.route.content() else {
                Issue.record("\(screen) is not native")
                continue
            }
        }
        #expect(Set(ScreenShortcut.allCases.map(\.route)).count == ScreenShortcut.allCases.count)
    }

    @MainActor @Test func openingAScreenShortcutHandsItsRouteToTheRouter() async throws {
        _ = NotificationRouter.shared.take()
        _ = try await OpenScreenIntent(screen: .gifts).perform()
        #expect(NotificationRouter.shared.take() == NotificationDestination(route: .gifts))
    }

    // MARK: Dismissing a candidate

    private final class Requests: @unchecked Sendable {
        private let lock = NSLock()
        private var recorded: [(method: String, path: String, body: [String: Any])] = []
        var all: [(method: String, path: String, body: [String: Any])] { lock.withLock { recorded } }
        func record(_ request: URLRequest) {
            let json = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) }
            let body = (json as? [String: Any]) ?? (json as? [[String: Any]])?.first ?? [:]
            lock.withLock {
                recorded.append((request.httpMethod ?? "GET", request.url!.path, body))
            }
        }
    }

    private func dismisser(_ requests: Requests, transactions: String) -> GiftCandidateDismisser {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("NotificationActionsTests-\(UUID().uuidString)", isDirectory: true)
        return GiftCandidateDismisser(
            data: NestData(
                api: SupabaseAPI(
                    baseURL: URL(string: "https://example.supabase.co")!, anonKey: "a",
                    accessToken: { "t" },
                    send: { request in
                        requests.record(request)
                        let isRead = request.httpMethod == "GET"
                        return (
                            Data((isRead ? transactions : "[]").utf8),
                            HTTPURLResponse(
                                url: request.url!, statusCode: 200, httpVersion: nil,
                                headerFields: nil)!)
                    }),
                cache: RowCache(directory: directory), userID: { "u" }))
    }

    private let transaction = """
        [{"id":"tx-1","household_id":"h","account_id":"a","amount_cents":-500,\
        "category_id":null,"description":"Flowers","external_category":"gifts-and-charity",\
        "external_category_since":"2026-03-01T12:00:00+00:00","external_parent_category":null,\
        "is_categorizable":true,"transaction_type":null,"deep_link_url":null,\
        "up_message":null,"up_note":null,"performing_customer_name":null,\
        "reviewed_at":null,"reviewed_by_member_id":null,\
        "external_id":null,"kind":"expense","member_id":null,"notes":null,\
        "posted_at":"2026-03-01T12:00:00+00:00","source":"up","status":"settled",\
        "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]
        """

    @Test func dismissingWritesTheDismissalForTheTransactionsHousehold() async throws {
        let requests = Requests()
        let done = try await dismisser(requests, transactions: transaction)
            .dismiss(transactionID: "tx-1")
        #expect(done)
        let write = try #require(requests.all.last)
        #expect(write.method == "POST")
        #expect(write.path.hasSuffix("/gift_transaction_dismissal"))
        #expect(write.body["household_id"] as? String == "h")
        #expect(write.body["transaction_id"] as? String == "tx-1")
    }

    @Test func dismissingATransactionTheMemberCannotSeeWritesNothing() async throws {
        let requests = Requests()
        let done = try await dismisser(requests, transactions: "[]").dismiss(transactionID: "tx-1")
        #expect(!done)
        #expect(requests.all.allSatisfy { $0.method == "GET" })
    }
}
