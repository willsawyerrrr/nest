import Foundation

/// One breakdown in the list: its name, group and rolled-up totals.
struct BreakdownRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let groupLabel: String
    let color: ChartColorKey
    let annualCents: Int64
    let fortnightlyCents: Int64
}

/// One item in a breakdown's detail: its amount, cadence and fortnightly figure.
struct BreakdownItemRow: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let amountCents: Int
    let frequencyLabel: String
    let fortnightlyCents: Int64
}

/// A breakdown's detail: its items and the totals they roll up to.
struct BreakdownDetail: Equatable, Sendable {
    let row: BreakdownRow
    let items: [BreakdownItemRow]
}

/// The Breakdowns screens' derived figures and labels, mirroring the PWA's
/// `BreakdownsScreen` and `BreakdownDetail` so both surfaces label and total
/// identically. Totals come from the engine; this only looks them up and labels them.
struct BreakdownsPresentation: Sendable {
    let content: BreakdownsContent

    /// The household's breakdowns in stored order, each with its rolled-up totals.
    var rows: [BreakdownRow] {
        content.rows.breakdowns.map(row)
    }

    /// The breakdown with `id`, its items and totals; `nil` when it no longer exists.
    func detail(id: String) -> BreakdownDetail? {
        guard let breakdown = content.rows.breakdowns.first(where: { $0.id == id }) else {
            return nil
        }
        let fortnightly = Dictionary(
            content.rollups.items.map { ($0.itemId, $0.fortnightlyCents) },
            uniquingKeysWith: { first, _ in first })
        let items = content.rows.items.filter { $0.breakdownId == id }.map { item in
            BreakdownItemRow(
                id: item.id, name: item.name, amountCents: item.amountCents,
                frequencyLabel: Self.frequencyLabel(item.frequency, interval: item.intervalCount),
                fortnightlyCents: fortnightly[item.id] ?? 0)
        }
        return BreakdownDetail(row: row(breakdown), items: items)
    }

    private func row(_ breakdown: Breakdown) -> BreakdownRow {
        let total = content.rollups.totals.first { $0.breakdownId == breakdown.id }
        return BreakdownRow(
            id: breakdown.id, name: breakdown.name,
            groupLabel: Self.groupLabel(breakdown.lineGroup),
            color: Self.color(breakdown.lineGroup),
            annualCents: total?.annualCents ?? 0, fortnightlyCents: total?.fortnightlyCents ?? 0)
    }

    static func groupLabel(_ group: BudgetGroup) -> String {
        switch group {
        case .needs: "Needs"
        case .wants: "Wants"
        case .discretionary: "Discretionary"
        case .savings: "Savings"
        case .investments: "Investments"
        }
    }

    static func color(_ group: BudgetGroup) -> ChartColorKey {
        switch group {
        case .needs: .needs
        case .wants: .wants
        case .discretionary: .discretionary
        case .savings: .savings
        case .investments: .investments
        }
    }

    /// `Weekly`, `Annually`, `Every 4 weeks`, `Every month` (an interval of 1), or
    /// `Every N weeks` when an interval cadence has no valid interval.
    static func frequencyLabel(_ frequency: Frequency, interval: Int?) -> String {
        switch frequency {
        case .weekly: "Weekly"
        case .fortnightly: "Fortnightly"
        case .monthly: "Monthly"
        case .quarterly: "Quarterly"
        case .biannual: "Biannually"
        case .annual: "Annually"
        case .everyNWeeks: every(interval, unit: "week")
        case .everyNMonths: every(interval, unit: "month")
        }
    }

    private static func every(_ interval: Int?, unit: String) -> String {
        guard let interval, interval != 0 else { return "Every N \(unit)s" }
        return interval == 1 ? "Every \(unit)" : "Every \(interval) \(unit)s"
    }
}
