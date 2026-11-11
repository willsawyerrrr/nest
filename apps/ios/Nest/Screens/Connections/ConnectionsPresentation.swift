import Foundation

/// A status pill's label and tone.
struct ConnectionStatus: Equatable {
    enum Tone: Equatable { case positive, neutral, warning }

    let label: String
    let tone: Tone
}

/// Where a completed (or abandoned) Redbark Link Session round-trip landed.
enum RedbarkCompleteResult: Equatable {
    case connected
    case pending
    case failed(code: String?)
}

/// Copy and derived values for the Connections screen, mirroring the PWA's
/// `ConnectionsScreen` and `CalendarFeedControl`.
enum ConnectionsPresentation {
    static let title = "Connections"

    /// A member's Up connection: connected, needing reconnection, or not connected.
    static func upStatus(_ member: Member) -> ConnectionStatus {
        if member.upSyncFailedAt != nil { return .init(label: "Needs reconnecting", tone: .warning) }
        if member.upConnectedAt != nil { return .init(label: "Connected", tone: .positive) }
        return .init(label: "Not connected", tone: .neutral)
    }

    /// A Redbark connection's status pill: `active` is green, anything else grey.
    static func bankStatus(_ connection: RedbarkConnection) -> ConnectionStatus {
        .init(label: connection.status, tone: connection.status == "active" ? .positive : .neutral)
    }

    /// The institution's name, or fixed fallback copy.
    static func institution(_ connection: RedbarkConnection) -> String {
        connection.institutionName ?? "Unknown institution"
    }

    /// The name of the member `id`, or `Unknown`.
    static func memberName(_ members: [Member], id: String) -> String {
        members.first { $0.id == id }?.name ?? "Unknown"
    }

    static let upTitle = "Connect Up"
    static let reconnectTitle = "Your Up connection needs reconnecting"
    static let reconnectMessage = "Up rejected your personal access token. Paste a fresh one to resume syncing."
    static let upIntro =
        "Paste your Up personal access token to connect your accounts. It is stored securely and never shown again."
    static let upTokenLabel = "Up personal access token"
    static let upTokenPlaceholder = "up:yeah:…"

    static func upSubmitLabel(needsReconnecting: Bool) -> String {
        needsReconnecting ? "Reconnect" : "Connect"
    }

    static let bankTitle = "Connect a bank"
    static let bankIntro =
        "Connect a bank account via Redbark to fund budget items and pay splits, or link it as a savings goal's saver. You'll be sent to a hosted consent screen to authorise access."
    static let disconnectBankTitle = "Disconnect bank?"
    static let disconnectBankDescription = "Its accounts stop syncing."
    static let connectBankFailureTitle = "Couldn’t connect a bank"

    /// Where a Redbark plan without API access is upgraded.
    static let redbarkBillingURL = URL(string: "https://app.redbark.com/settings/billing")!

    /// Our own copy for a failed Redbark call, keyed on the edge function's stable error code.
    static func failureMessage(code: String?) -> AttributedString {
        switch code {
        case "plan_upgrade_required":
            var link = AttributedString("Upgrade your plan")
            link.link = redbarkBillingURL
            return AttributedString("Bank connections need the Redbark Developer or Professional plan. ")
                + link + AttributedString(".")
        case "redbark_auth_failed":
            return AttributedString("Bank connections are misconfigured. Try again later.")
        default:
            return AttributedString("Redbark is unavailable right now. Try again shortly.")
        }
    }

    /// The banner title and message for a resolved Redbark round-trip.
    static func banner(for result: RedbarkCompleteResult) -> (title: String, message: AttributedString) {
        switch result {
        case .connected:
            ("Bank connected", AttributedString("Syncing its accounts now."))
        case .failed(let code):
            ("Connection failed", failureMessage(code: code))
        case .pending:
            (
                "Still connecting",
                AttributedString("The connection hasn’t finished yet. Check back shortly, or try connecting again.")
            )
        }
    }

    static let feedTitle = "Calendar feed"
    static let feedIntro =
        "Generate a private link that adds your household's money dates — expected pay, savings-goal and temporary-item targets, and the financial-year boundary — to any calendar app as a read-only subscription."
    static let feedGenerateLabel = "Generate calendar feed"
    static let feedHowTo =
        "In your calendar app, choose \"Subscribe from URL\" (Google Calendar) or \"Add calendar subscription\" (Apple Calendar) and paste this link."
    static let feedShownOnce =
        "The subscription URL is shown only once. Regenerate to get a new one — the previous link stops working."

    /// The subscription URL for `token` under `base`, over `https` and `webcal`.
    static func feedURLs(token: String, base: URL) -> (https: String, webcal: String) {
        let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlUnreserved) ?? token
        let https = "\(base.absoluteString)/functions/v1/calendar-ics?token=\(encoded)"
        let webcal = https.hasPrefix("https://") ? "webcal://" + https.dropFirst("https://".count) : https
        return (https, webcal)
    }
}

private extension CharacterSet {
    /// `encodeURIComponent`'s unescaped set.
    static let urlUnreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
}
