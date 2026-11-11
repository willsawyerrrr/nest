import Foundation

/// Every row the Notifications screen reads.
struct NotificationsRows: Codable, Sendable, Equatable {
    var preferences: [NotificationPreference] = []
    var members: [Member] = []

    /// The member's preferences (row-level security returns only the caller's own)
    /// and the household's members, whose rows give the caller's member and household.
    static var sources: [TableSource<NotificationsRows>] {
        [
            .table(NotificationPreference.self) { $0.preferences = $1 },
            .table(Member.self, order: [Order(column: "name")]) { $0.members = $1 },
        ]
    }

    /// The signed-in member: the `members` row whose `user_id` is the session user.
    func member(userID: String) -> Member? { members.first { $0.userId == userID } }
}

/// The body of a preference upsert, keyed on `member_id,trigger`.
struct NotificationPreferenceUpsert: Encodable, Equatable, Sendable {
    let householdID: String
    let memberID: String
    let trigger: NotificationTrigger
    let enabled: Bool

    static let onConflict = "member_id,trigger"

    enum CodingKeys: String, CodingKey {
        case trigger, enabled
        case householdID = "household_id"
        case memberID = "member_id"
    }
}

/// What the `push-test` function reports back about a test send.
struct PushTestResult: Decodable, Equatable, Sendable {
    struct Failure: Decodable, Equatable, Sendable {
        let channel: String
        let reason: String
    }

    /// Every device the member had registered when the send started.
    let devices: Int
    let sent: Int
    /// Dead endpoints the send discovered and deleted.
    let pruned: Int
    /// Devices neither reached nor pruned.
    let failed: Int
    let failures: [Failure]?
}
