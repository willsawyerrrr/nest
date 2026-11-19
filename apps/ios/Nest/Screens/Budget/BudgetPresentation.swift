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
    /// The page managing or cancelling the subscription the line pays for.
    var managementURL: URL?
    /// What a derived line rolls up from; `nil` for a manual line.
    var source: DerivedSource?

    /// Where a derived line's amount comes from and is edited.
    enum DerivedSource: Equatable, Sendable {
        case gifts
        case breakdown(id: String)

        /// The screen the line's chevron opens.
        var route: Route { self == .gifts ? .gifts : .breakdowns }
    }
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
    /// The account funding the allowance, shown on a co-member's row.
    var route: String?

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
            route: route(of: line),
            managementURL: line.managementUrl.flatMap(URL.init(string:)),
            source: line.isGiftLine
                ? .gifts : line.breakdownId.map { BudgetLineRow.DerivedSource.breakdown(id: $0) })
    }

    /// The budget line `id`, as stored (or as the sandbox holds it).
    func line(id: String) -> BudgetLine? { rows.budgetLines.first { $0.id == id } }

    /// The breakdown owning the line `id`, when it is a generic derived line.
    func breakdown(owning id: String) -> Breakdown? {
        guard let breakdownID = line(id: id)?.breakdownId else { return nil }
        return rows.breakdowns.first { $0.id == breakdownID }
    }

    /// The member allowance row of `memberID`.
    func allowance(of memberID: String) -> MemberAllowance? {
        rows.memberAllowances.first { $0.memberId == memberID }
    }

    /// The signed-in member's allowance as the one a Discretionary line may draw
    /// from, with what is left of it over a year, as the PWA's `allowanceChoices`.
    var allowanceChoices: [AllowanceChoice] {
        guard let own = content.currentMemberID,
            let summary = content.overview.allowances.first(where: { $0.memberId == own }),
            let member = rows.members.first(where: { $0.id == own })
        else { return [] }
        return [
            AllowanceChoice(
                memberId: own, name: Self.allowanceName(member.name),
                remainingAnnualCents: Int(summary.remaining.annualCents))
        ]
    }

    /// The annual cents drawn from `memberID`'s allowance that the signed-in member can read.
    func drawnAnnualCents(of memberID: String) -> Int {
        Int(content.overview.allowances.first { $0.memberId == memberID }?.drawn.annualCents ?? 0)
    }

    /// The goals a Savings/Investments line may link, as the form offers them.
    var goalOptions: [(id: String, name: String)] { rows.savingsGoals.map { ($0.id, $0.name) } }

    /// The accounts a line or allowance may be funded from.
    var accountOptions: [(id: String, name: String)] { rows.fundingAccounts }

    /// The funding account's label for `memberID`'s allowance, when it has one.
    func allowanceRoute(of memberID: String) -> String? {
        guard let account = allowance(of: memberID)?.destinationAccountId else { return nil }
        return rows.accounts.first { $0.id == account }?.name.map(accountLabel)
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
        return rows.accounts.first { $0.id == line.destinationAccountId }?.name.map(accountLabel)
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
                remainingCents: own ? summary.remaining.fortnightlyCents : nil,
                route: allowanceRoute(of: summary.memberId))
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
