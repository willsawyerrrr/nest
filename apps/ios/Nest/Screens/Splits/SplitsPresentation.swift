import Foundation

/// Which field the split rows are ordered by.
enum SplitsSortKey: String, CaseIterable, Sendable {
    case title, amount

    var label: String { self == .title ? "Title" : "Amount" }
}

/// One routed account as listed: its identity, exact and rounded fortnightly
/// figures, the confirmed split, and the budget lines behind it.
struct SplitRow: Equatable, Identifiable, Sendable {
    let id: String
    let emoji: String?
    let label: String
    let deletedAtSource: Bool
    let exactCents: Int
    let roundedCents: Int
    let configuredCents: Int?
    let needsUpdate: Bool
    let lines: [PaySplitRoutes.Line]

    /// The exact figure beside a rounded headline, only when rounding changed it.
    var exactNote: String? {
        roundedCents == exactCents ? nil : "\(MoneyFormat.cents(exactCents)) exact"
    }

    /// The drift line: what was confirmed and what it becomes, or that it was never set.
    var driftNote: String {
        configuredCents.map {
            "was \(MoneyFormat.cents($0)) → \(MoneyFormat.perFortnight(roundedCents))"
        } ?? "Not set yet"
    }

    /// The drift line's action.
    var confirmLabel: String { configuredCents == nil ? "Mark as set" : "Confirm" }
}

/// A spending account the pay account can be chosen from.
struct PayAccountOption: Equatable, Identifiable, Sendable {
    let id: String
    let label: String
}

/// The Pay splits screen's figures, labelled as the PWA's `SplitsScreen` shows
/// them: rows rounded up to the nearest $5, split into those recommended as pay
/// splits and those that stay in the pay account, flagged where the confirmed
/// split has drifted.
struct SplitsPresentation: Equatable, Sendable {
    /// Pay splits are typed into a bank's app in round figures.
    static let roundStepCents = 5_00

    static let title = "Pay splits"
    static let intro =
        "No bank exposes an API to read or set your pay split, so these are recommendations: set each account’s pay split with its own bank to match. Amounts are the fortnightly total of the budget items routed to each account, rounded up to the nearest $5."
    static let paidIntoLabel = "Paid into"
    static let paidIntoDescription =
        "The spending account your pay lands in. Every other spending account and saver is then a recommended split."
    static let paidIntoPlaceholder = "Choose a spending account"
    static let choosePayAccountTitle = "Choose the account you’re paid into"
    static let choosePayAccountMessage =
        "Pick the spending account your pay lands in above. Once set, your other spending accounts join the recommended pay splits alongside your savers."
    static let nothingRouted =
        "Route budget items to an account — set “Funded from” on an item, or link a Savings goal to a synced saver — to see recommended splits here."
    static let staysNote = "Pay lands here — no transfer needed."
    static let recommendedTitle = "Recommended pay splits"

    let payAccountId: String?
    let spendingAccounts: [PayAccountOption]
    let recommended: [SplitRow]
    let stays: [SplitRow]
    let unassignedCents: Int
    let nothingRoutedYet: Bool

    var hasPayAccount: Bool { payAccountId != nil }

    var staysTitle: String {
        hasPayAccount ? "Stays in your pay account" : "Stays in your spending account"
    }

    /// Accounts whose recommendation differs from the confirmed split.
    var rowsToUpdate: Int { recommended.filter(\.needsUpdate).count }

    var unassignedMessage: String {
        "\(MoneyFormat.perFortnight(unassignedCents)) comes from budget items not yet routed to an account. Set a “Funded from” account on those items, or link their Savings goal to a synced saver, to fold them into a split."
    }

    /// Whether the payer needs a chooser at all (any spending account exists).
    var showsPayAccountChooser: Bool { !spendingAccounts.isEmpty }

    init(
        content: SplitsContent, sortKey: SplitsSortKey = .title, ascending: Bool = true
    ) {
        let rows = content.rows
        let accounts = rows.splittableAccounts
        let byID = Dictionary(
            accounts.compactMap { account in account.id.map { ($0, account) } },
            uniquingKeysWith: { $1 })
        let configured = rows.configuredByAccount
        let payAccountId = rows.payAccountId
        self.payAccountId = payAccountId
        spendingAccounts = accounts.compactMap { account in
            guard account.type == .transaction, let id = account.id else { return nil }
            return PayAccountOption(id: id, label: accountLabel(account.name ?? ""))
        }

        let all: [SplitRow] = content.routes.accounts.compactMap { route in
            guard let account = byID[route.accountId] else { return nil }
            let rounded = Self.roundCentsUp(route.fortnightlyCents)
            let configuredCents = configured[route.accountId]
            return SplitRow(
                id: route.accountId, emoji: Self.emoji(of: account.name ?? ""),
                label: accountLabel(account.name ?? ""),
                deletedAtSource: account.deletedFromSourceAt != nil,
                exactCents: route.fortnightlyCents, roundedCents: rounded,
                configuredCents: configuredCents,
                needsUpdate: Self.needsUpdate(rounded, configured: configuredCents),
                lines: route.lines)
        }
        let isRecommended: (SplitRow) -> Bool = { row in
            let account = byID[row.id]
            return Self.isRecommended(
                isPayAccount: row.id == payAccountId,
                isSaver: account.map { $0.source != .manual && $0.type == .savings } ?? false,
                hasPayAccount: payAccountId != nil)
        }
        recommended = Self.sorted(all.filter(isRecommended), by: sortKey, ascending: ascending)
        stays = Self.sorted(all.filter { !isRecommended($0) }, by: sortKey, ascending: ascending)
        unassignedCents = content.routes.unassignedFortnightlyCents
        nothingRoutedYet = all.isEmpty && content.routes.unassignedFortnightlyCents == 0
    }

    /// `roundCentsUpToStep(cents, 5_00)`: up to the next $5, never below the amount.
    static func roundCentsUp(_ cents: Int, step: Int = roundStepCents) -> Int {
        guard step > 0 else { return cents }
        return Int((Double(cents) / Double(step)).rounded(.up)) * step
    }

    /// `paySplitNeedsUpdate`: a never-confirmed split always does.
    static func needsUpdate(_ recommendedCents: Int, configured: Int?) -> Bool {
        configured.map { $0 != recommendedCents } ?? true
    }

    /// `isRecommendedSplitAccount`: with a pay account every other routed account
    /// is a split; without one, only savers.
    static func isRecommended(isPayAccount: Bool, isSaver: Bool, hasPayAccount: Bool) -> Bool {
        hasPayAccount ? !isPayAccount : isSaver
    }

    /// The account name's leading emoji (the Up icon), when its label is not just the emoji.
    static func emoji(of name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first, accountLabel(trimmed) != trimmed else { return nil }
        return String(first)
    }

    /// Orders rows by the chosen key; descending reverses the ascending order, ties
    /// keeping routing order, as the PWA's `sortBy` does.
    static func sorted(_ rows: [SplitRow], by key: SplitsSortKey, ascending: Bool) -> [SplitRow] {
        let indexed = rows.enumerated().sorted { a, b in
            let order: ComparisonResult =
                key == .title
                ? a.element.label.localizedCompare(b.element.label)
                : (a.element.exactCents < b.element.exactCents
                    ? .orderedAscending
                    : a.element.exactCents > b.element.exactCents ? .orderedDescending : .orderedSame)
            return order == .orderedSame ? a.offset < b.offset : order == .orderedAscending
        }
        let result = indexed.map(\.element)
        return ascending ? result : result.reversed()
    }
}
