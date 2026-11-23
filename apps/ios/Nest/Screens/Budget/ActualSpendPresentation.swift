import Foundation

/// The actual-spend copy, as the PWA's `ActualSpendBar`, `GroupSection` and
/// `CategoryGroupsModal` word it.
enum ActualSpendPresentation {
    /// What the bar's period is: this fortnight's spend or an earlier one's.
    static func heading(isCurrent: Bool) -> String {
        isCurrent ? "Spent this fortnight" : "Spent that fortnight"
    }

    /// `12 Nov 2026 – 25 Nov 2026`.
    static func periodLabel(_ period: SpendPeriod) -> String {
        "\(InflowsPresentation.formatIsoDate(period.periodStart)) – \(InflowsPresentation.formatIsoDate(period.periodEnd))"
    }

    /// `$45.10 in no group`, or nil where nothing went unbudgeted.
    static func unbudgeted(_ cents: Int64) -> String? {
        cents == 0 ? nil : "\(MoneyFormat.cents(Int(cents))) in no group"
    }

    /// A group's spend beside its planned fortnightly subtotal.
    struct GroupSpend: Equatable {
        /// `$412.50 spent`.
        let spent: String
        /// `$87.50 left`, or `$12.00 over` once spend passes the plan.
        let remaining: String
        /// Positive while under the plan, negative once over, zero on it.
        let sign: MoneySign
    }

    static func groupSpend(plannedCents: Int64, spentCents: Int64) -> GroupSpend {
        let left = plannedCents - spentCents
        return GroupSpend(
            spent: "\(MoneyFormat.cents(Int(spentCents))) spent",
            remaining: left < 0
                ? "\(MoneyFormat.cents(Int(-left))) over" : "\(MoneyFormat.cents(Int(left))) left",
            sign: MoneySign(cents: Int(left)))
    }

    /// A group's name, or "No group".
    static func groupName(_ group: BudgetGroup?) -> String { group?.title ?? "No group" }

    /// The picker's label for `choice`: `Default (Needs)` for the shared default.
    static func choiceLabel(_ choice: CategoryGroupChoice, defaultGroup: BudgetGroup?) -> String {
        switch choice {
        case .shared: "Default (\(groupName(defaultGroup)))"
        case .override(let group): groupName(group)
        }
    }

    /// Every choice the picker offers, in the PWA's order: the default, each group, then no group.
    static let choices: [CategoryGroupChoice] =
        [.shared] + BudgetGroup.allCases.map { .override($0) } + [.override(nil)]
}
