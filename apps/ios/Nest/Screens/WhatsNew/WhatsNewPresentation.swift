import Foundation

/// One changelog row: the type's emoji, the description and, for a merged
/// change, its date. Mirrors the PWA's `ChangelogScreen`.
struct ChangelogRow: Equatable, Identifiable, Sendable {
    let id: String
    let emoji: String?
    /// Accessibility label and tooltip of `emoji`.
    let emojiLabel: String?
    let description: String
    /// The change's date as `28 Feb 2027`; `nil` while in progress.
    let date: String?
}

/// The What's new screen's copy and rows, labelled as the PWA's.
struct WhatsNewPresentation: Equatable, Sendable {
    static let title = "What's new"
    static let loadError = "Could not load what's new. Try again later."
    static let notConfigured = "The changelog isn't configured yet."
    static let updateTitle = "Update available"
    static let inProgressTitle = "In progress"
    static let inProgressEmpty = "Nothing in the works right now."
    static let implementedTitle = "Implemented"
    static let implementedEmpty = "Nothing here yet."
    static let homebrewInstruction = "Run this in Terminal to upgrade."

    let content: WhatsNewContent

    var configured: Bool { content.changelog.configured }
    var inProgress: [ChangelogRow] { content.changelog.inProgress.map(Self.row) }
    var implemented: [ChangelogRow] { content.changelog.implemented.map(Self.row) }

    /// The update alert's message: the new version and where to get it.
    var updateMessage: String? {
        guard let update = content.update else { return nil }
        switch update.channel {
        case .appStore: return "Version \(update.version) is available on the App Store."
        case .homebrew: return "Version \(update.version) is available. \(Self.homebrewInstruction)"
        }
    }

    /// The App Store page, for the update alert's button.
    var updateLink: URL? {
        guard let update = content.update, update.channel == .appStore else { return nil }
        return update.url
    }

    /// The upgrade command, when the update comes from Homebrew.
    var upgradeCommand: String? {
        content.update?.channel == .homebrew ? UpdateChannel.upgradeCommand : nil
    }

    private static let types: [String: (emoji: String, label: String)] = [
        "feat": ("🚀", "Feature"), "fix": ("🛠️", "Fix"), "perf": ("⚡", "Improvement"),
    ]

    private static func row(_ entry: ImplementedEntry) -> ChangelogRow {
        row(id: entry.sha, type: entry.type, description: entry.description, date: entry.date)
    }

    private static func row(_ entry: InProgressEntry) -> ChangelogRow {
        row(id: String(entry.number), type: entry.type, description: entry.description, date: nil)
    }

    private static func row(id: String, type: String, description: String, date: String?)
        -> ChangelogRow
    {
        let meta = types[type]
        return ChangelogRow(
            id: id, emoji: meta?.emoji, emojiLabel: meta?.label, description: description,
            date: date.flatMap(formatDate))
    }

    /// An ISO timestamp's calendar date (its first ten characters) as `28 Feb 2027`.
    static func formatDate(_ iso: String) -> String? {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("d MMM yyyy")
        return formatter.string(from: date)
    }
}
