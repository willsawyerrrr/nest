import Foundation

/// The Household screen's copy and invite-code phrasing, as the PWA's `HouseholdScreen`.
enum HouseholdPresentation {
    static let title = "Household"
    static let inviteTitle = "Invite someone"
    static let signOutLabel = "Sign out"
    static let inviteCodeLabel = "Invite code:"
    static let copyLabel = "Copy"
    static let copiedLabel = "Copied"
    static let regenerateLabel = "Regenerate"
    static let revokeLabel = "Revoke"
    static let createLabel = "Create invite code"
    static let createHint =
        "Generate a single-use code to let someone join your household. It expires after 7 days."
    static let actionError = "Something went wrong. Please try again."

    static func signedInAs(_ email: String) -> String { "Signed in as \(email)" }

    /// The hint under an active code, ending with how long it has left.
    static func activeHint(expiresAt: Date, now: Date) -> String {
        "Share this code with others so they can join your household. It works once and then expires. \(expiryLabel(expiresAt: expiresAt, now: now))."
    }

    /// When an active invite code lapses, e.g. "Expires in 3 days".
    static func expiryLabel(expiresAt: Date, now: Date) -> String {
        let days = Int((expiresAt.timeIntervalSince(now) / 86_400).rounded(.up))
        return days <= 1 ? "Expires within a day" : "Expires in \(days) days"
    }

    /// The household's invite code while it has not expired, with its expiry.
    static func activeInvite(_ household: Household, now: Date) -> (code: String, expiresAt: Date)? {
        guard let code = household.inviteCode, let raw = household.inviteCodeExpiresAt,
            let expiresAt = date(from: raw), expiresAt > now
        else { return nil }
        return (code, expiresAt)
    }

    /// Parses a Postgres `timestamptz`, with or without fractional seconds.
    static func date(from raw: String) -> Date? {
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: raw) { return date }
        let trimmed = raw.replacingOccurrences(
            of: #"\.\d+"#, with: "", options: .regularExpression)
        return plain.date(from: trimmed)
    }
}
