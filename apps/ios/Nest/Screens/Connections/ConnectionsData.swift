import Foundation

/// Every row the Connections screen reads.
struct ConnectionsRows: Codable, Sendable, Equatable {
    var members: [Member] = []
    var redbarkConnections: [RedbarkConnection] = []
    var calendarFeed: CalendarFeed?

    /// Members, the household's Redbark connections (newest first, as the PWA reads
    /// them) and its calendar-feed row, when one was generated.
    static var sources: [TableSource<ConnectionsRows>] {
        [
            .table(Member.self) { $0.members = $1 },
            .table(RedbarkConnection.self, order: [Order(column: "created_at", ascending: false)]) {
                $0.redbarkConnections = $1
            },
            .table(CalendarFeed.self) { $0.calendarFeed = $1.first },
        ]
    }

    /// The signed-in member: the `members` row whose `user_id` is `userID`.
    func member(userID: String?) -> Member? {
        members.first { $0.userId == userID }
    }
}

/// The body of `up-connect`. The token is only ever held in this value for the
/// request; it is never logged or cached.
struct UpConnectBody: Encodable, Sendable {
    let token: String
}

/// The body of `redbark-connect`.
struct RedbarkConnectBody: Encodable, Sendable {
    let returnUrl: String
}

/// The response of `redbark-connect`.
struct RedbarkLink: Decodable, Sendable {
    let linkSessionId: String
    let url: URL
}

/// The body of `redbark-connect-complete`.
struct RedbarkCompleteBody: Encodable, Sendable {
    let linkSessionId: String
}

/// The response of `redbark-connect-complete`.
struct RedbarkCompletion: Decodable, Sendable {
    let connected: Bool
    let status: String?
}

/// The body of `redbark-disconnect`.
struct RedbarkDisconnectBody: Encodable, Sendable {
    let connectionId: String
}

/// A response whose content is not read.
struct IgnoredResponse: Decodable, Sendable {
    init(from decoder: Decoder) throws {}
}
