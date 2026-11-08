import Foundation

extension Frequency {
    /// The cadence as the PWA's `formatFrequency` labels it: `Weekly`, `Every 3 weeks`.
    func label(interval: Int?) -> String {
        switch self {
        case .weekly: "Weekly"
        case .fortnightly: "Fortnightly"
        case .monthly: "Monthly"
        case .quarterly: "Quarterly"
        case .biannual: "Biannually"
        case .annual: "Annually"
        case .everyNWeeks: Self.every(interval, unit: "week")
        case .everyNMonths: Self.every(interval, unit: "month")
        }
    }

    private static func every(_ interval: Int?, unit: String) -> String {
        guard let interval, interval >= 1 else { return "Every N \(unit)s" }
        return interval == 1 ? "Every \(unit)" : "Every \(interval) \(unit)s"
    }
}

extension BudgetGroup {
    var title: String {
        switch self {
        case .needs: "Needs"
        case .wants: "Wants"
        case .discretionary: "Discretionary"
        case .savings: "Savings"
        case .investments: "Investments"
        }
    }
}

/// An account or goal name without its leading emoji (the Up account icon), as the PWA's `accountLabel` strips it.
func accountLabel(_ name: String) -> String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let first = trimmed.first, let scalar = first.unicodeScalars.first,
        scalar.properties.isEmojiPresentation || (scalar.properties.isEmoji && scalar.value > 0x238C)
    else { return trimmed }
    let rest = trimmed.dropFirst().trimmingCharacters(in: .whitespacesAndNewlines)
    return rest.isEmpty ? trimmed : rest
}

/// One budget line as listed: its amount on its own cadence, and its fortnightly figure.
struct BudgetLineRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let amountCents: Int
    let cadence: String
    let fortnightlyCents: Int64
    /// Where the line sends its money: its allowance, goal or funding account.
    let route: String?
}

struct BudgetGroupSection: Equatable, Identifiable, Sendable {
    let group: BudgetGroup
    let subtotalCents: Int64
    let lines: [BudgetLineRow]

    var id: BudgetGroup { group }
    var title: String { group.title }
}

/// One member's allowance. `drawn` and `remaining` are the owner's alone.
struct AllowanceRow: Equatable, Identifiable, Sendable {
    let memberID: String
    let title: String
    let amountCents: Int
    let cadence: String
    let fortnightlyCents: Int64
    let drawnCents: Int64?
    let remainingCents: Int64?

    var id: String { memberID }
    var isOwn: Bool { drawnCents != nil }

    /// The share of the allowance drawn, capped at the whole.
    var usedFraction: Double {
        guard let drawnCents, fortnightlyCents > 0 else { return 0 }
        return min(1, Double(drawnCents) / Double(fortnightlyCents))
    }
}

struct TemporaryRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let contributionCents: Int
    let targetDate: String
    let isActive: Bool
}

/// The Budget and Allowance screens' derived rows, mirroring the PWA's
/// `BudgetLineList`, `MemberAllowanceList` and `AllowanceScreen` so both
/// surfaces list, route and label the engine's figures identically.
struct BudgetPresentation: Sendable {
    let content: BudgetContent

    /// What the Allowance screen says an allowance is: a budgeting envelope, not extra money.
    static let allowanceNote =
        "Items drawn from it count against it, not on top of it."
    /// The overdraw guard, as fixed copy: the database refuses an item or an
    /// allowance change that would break it.
    static let overdrawGuard =
        "An item cannot draw more than is left in the allowance, and an allowance cannot be lowered below what is already drawn from it."

    private var rows: BudgetRows { content.rows }

    private var allowanceNames: [String: String] {
        Dictionary(
            rows.members.map { ($0.id, Self.allowanceName($0.name)) }, uniquingKeysWith: { $1 })
    }

    /// `Ada’s allowance`.
    static func allowanceName(_ memberName: String) -> String { "\(memberName)’s allowance" }

    private func row(_ line: BudgetLine, at index: Int) -> BudgetLineRow {
        BudgetLineRow(
            id: line.id, name: line.name, amountCents: line.amountCents,
            cadence: line.frequency.label(interval: line.intervalCount),
            fortnightlyCents: content.overview.lines[index].fortnightlyCents,
            route: route(of: line))
    }

    /// Where `line` sends its money. A line drawn from an allowance names it; a
    /// savings or investments line names its goal; any other names its account.
    func route(of line: BudgetLine) -> String? {
        if let member = line.allowanceMemberId, let name = allowanceNames[member] {
            return name
        }
        if line.lineGroup == .savings || line.lineGroup == .investments {
            return rows.savingsGoals.first { $0.id == line.goalId }.map { accountLabel($0.name) }
        }
        return rows.accounts.first { $0.id == line.destinationAccountId }
            .map { accountLabel($0.name) }
    }

    /// The five groups with the engine's subtotals. The signed-in member's
    /// allowance items are on the Allowance screen, not here.
    var groups: [BudgetGroupSection] {
        let own = content.currentMemberID
        let hasOwnAllowance = own != nil && rows.memberAllowances.contains { $0.memberId == own }
        return BudgetGroup.allCases.map { group in
            BudgetGroupSection(
                group: group, subtotalCents: content.overview.groups[group],
                lines: rows.budgetLines.enumerated().compactMap { index, line in
                    guard line.lineGroup == group else { return nil }
                    if hasOwnAllowance && line.allowanceMemberId == own { return nil }
                    return row(line, at: index)
                })
        }
    }

    /// Every member's allowance, in the engine's order; only the owner's carries drawn and left.
    var allowances: [AllowanceRow] {
        content.overview.allowances.compactMap { summary in
            guard let allowance = rows.memberAllowances.first(where: { $0.memberId == summary.memberId }),
                let member = rows.members.first(where: { $0.id == summary.memberId })
            else { return nil }
            let own = summary.memberId == content.currentMemberID
            return AllowanceRow(
                memberID: summary.memberId, title: Self.allowanceName(member.name),
                amountCents: allowance.amountCents,
                cadence: allowance.frequency.label(interval: allowance.intervalCount),
                fortnightlyCents: summary.allowance.fortnightlyCents,
                drawnCents: own ? summary.drawn.fortnightlyCents : nil,
                remainingCents: own ? summary.remaining.fortnightlyCents : nil)
        }
    }

    /// The signed-in member's allowance, when they have one.
    var ownAllowance: AllowanceRow? { allowances.first(where: \.isOwn) }

    /// The lines drawn from the signed-in member's allowance.
    var drawnLines: [BudgetLineRow] {
        guard let own = content.currentMemberID else { return [] }
        return rows.budgetLines.enumerated().compactMap { index, line in
            line.allowanceMemberId == own ? row(line, at: index) : nil
        }
    }

    var temporaryItems: [TemporaryRow] {
        rows.temporaryItems.enumerated().map { index, item in
            TemporaryRow(
                id: item.id, name: item.name, contributionCents: item.contributionCents,
                targetDate: item.targetDate,
                isActive: content.overview.temporaryActive[index])
        }
    }

    /// `31 Mar 2027` for an ISO `YYYY-MM-DD` date.
    static func date(_ iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
            let date = Calendar(identifier: .gregorian).date(
                from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        else { return iso }
        return date.formatted(
            .dateTime.day().month(.abbreviated).year().locale(Locale(identifier: "en_AU")))
    }
}
