import Foundation

/// One member's super profile as a compact row.
struct SuperProfileRow: Equatable, Sendable {
    let memberName: String
    /// The trimmed fund name; `nil` when none is set.
    let fundName: String?
    let isEstimated: Bool
    let effectiveCents: Int
    let caption: String?
}

/// One cap line and its over-cap warning.
struct SuperCapLine: Equatable, Sendable {
    let label: String
    let usedCents: Int
    let capCents: Int
    let note: String
    let warning: String?
}

/// A member's cap status.
struct SuperCapsRow: Equatable, Sendable {
    let lines: [SuperCapLine]
    let coContribution: String?
}

/// One contribution in a member's list.
struct SuperContributionRow: Equatable, Identifiable, Sendable {
    let id: String
    let kind: String
    let frequency: String
    let isFHSS: Bool
    let value: String
    let contributor: String?
}

/// A member's retirement projection card.
struct SuperProjectionCard: Equatable, Sendable {
    let projection: SuperProjection?
    let currentBalanceCents: Int
    let netAnnualContributionCents: Int
    let retirementAge: Int
    /// Whole-percentage split of the nominal balance: its current and grown shares.
    let currentPct: Int
    let growthPct: Int
}

/// One member's section: profile, caps, contributions and projection.
struct SuperMemberSection: Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let profile: SuperProfileRow
    let caps: SuperCapsRow?
    let contributions: [SuperContributionRow]
    let projection: SuperProjectionCard
}

/// The Super screen's labels and derived rows, mirroring the PWA's `SuperScreen`,
/// `SuperCapsSummary`, `SuperContributionList` and `RetirementProjection` so both
/// surfaces label identically. Figures come from the engine.
struct SuperPresentation: Sendable {
    static let intro =
        "Each member’s balance is held as an account and counts toward net worth. Concessional contributions reduce their taxable income on the Tax tab."
    static let projectionNote =
        "Estimates only, based on the assumptions below. Assumptions are shared and saved on this device; each member’s age is entered on their card."

    let content: SuperContent
    let projections: [SuperProjection?]
    let assumptions: RetirementAssumptions
    let ages: [String: Double]

    var title: String { "Super (FY\(content.financialYear))" }

    var sections: [SuperMemberSection] {
        let rows = content.rows
        return rows.members.enumerated().map { index, member in
            let figures = content.summary.members.first { $0.memberId == member.id }
            let effective = Int(figures?.effectiveBalanceCents ?? 0)
            let net = Int(figures?.netAnnualContributionCents ?? 0)
            let nominal = Int(projections.indices.contains(index) ? projections[index]?.nominalCents ?? 0 : 0)
            let share = Self.growthShare(currentCents: effective, nominalCents: nominal)
            return SuperMemberSection(
                id: member.id, name: member.name,
                profile: profile(member, effective: effective),
                caps: figures?.caps.map(Self.caps),
                contributions: rows.contributions.filter { $0.memberId == member.id }.map {
                    contribution($0)
                },
                projection: SuperProjectionCard(
                    projection: projections.indices.contains(index) ? projections[index] : nil,
                    currentBalanceCents: effective, netAnnualContributionCents: net,
                    retirementAge: Int(assumptions.retirementAge),
                    currentPct: share.current, growthPct: share.growth))
        }
    }

    private func profile(_ member: Member, effective: Int) -> SuperProfileRow {
        let rows = content.rows
        let profile = rows.profile(of: member)
        let baseline = rows.account(of: member)?.balanceCents ?? 0
        let asOf = profile?.balanceAsOf
        let accrued = effective - baseline
        let fund = profile?.fundName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return SuperProfileRow(
            memberName: member.name, fundName: fund?.isEmpty == false ? fund : nil,
            isEstimated: asOf != nil, effectiveCents: effective,
            caption: asOf.flatMap { date in
                accrued == 0
                    ? nil
                    : "\(MoneyFormat.cents(baseline)) confirmed on \(BudgetPresentation.date(date)) + \(MoneyFormat.cents(accrued)) accrued from contributions"
            })
    }

    static func caps(_ caps: SuperSummary.Caps) -> SuperCapsRow {
        func cents(_ value: Double) -> Int { Int(value.rounded()) }
        return SuperCapsRow(
            lines: [
                SuperCapLine(
                    label: "Concessional", usedCents: cents(caps.concessionalCents),
                    capCents: cents(caps.concessionalCapCents),
                    note: "Cap includes carry-forward from prior years.",
                    warning: caps.concessionalOverCap
                        ? "Over the concessional cap (\(MoneyFormat.cents(cents(caps.concessionalCapCents)))). Excess is taxed at your marginal rate."
                        : nil),
                SuperCapLine(
                    label: "Non-concessional", usedCents: cents(caps.nonConcessionalCents),
                    capCents: cents(caps.nonConcessionalCapCents),
                    note: "Bring-forward may allow up to 3× the cap.",
                    warning: caps.nonConcessionalOverCap
                        ? "Over the non-concessional cap (\(MoneyFormat.cents(cents(caps.nonConcessionalCapCents)))) — unless bring-forward applies."
                        : nil),
            ],
            coContribution: caps.coContributionCents > 0
                ? "Estimated government co-contribution \(MoneyFormat.cents(cents(caps.coContributionCents))), added to super."
                : nil)
    }

    private func contribution(_ row: SuperContribution) -> SuperContributionRow {
        SuperContributionRow(
            id: row.id, kind: Self.kindLabel(row.kind),
            frequency: BreakdownsPresentation.frequencyLabel(row.frequency, interval: row.intervalCount),
            isFHSS: row.fhssEligible, value: Self.value(row),
            contributor: row.contributorMemberId.map {
                id in "by \(content.rows.members.first { $0.id == id }?.name ?? "Unknown")"
            })
    }

    static func kindLabel(_ kind: SuperContributionKind) -> String {
        switch kind {
        case .salarySacrifice: "Salary sacrifice"
        case .personalDeductible: "Personal (deductible)"
        case .personalNonConcessional: "Personal (non-concessional)"
        case .spouse: "Spouse"
        }
    }

    /// A flat amount, or `10.5% of salary` for a percent-of-salary contribution.
    static func value(_ row: SuperContribution) -> String {
        guard row.mode == .percent else { return MoneyFormat.cents(row.amountCents ?? 0) }
        let percent = Double(row.percentBp ?? 0) / 100
        let text = percent == percent.rounded() ? String(Int(percent)) : String(percent)
        return "\(text)% of salary"
    }

    /// The whole-percentage split of the projected nominal balance into its current
    /// and grown shares.
    static func growthShare(currentCents: Int, nominalCents: Int) -> (current: Int, growth: Int) {
        guard nominalCents > 0 else { return (0, 0) }
        let current = min(100, Int((Double(currentCents) / Double(nominalCents) * 100).rounded()))
        return (current, 100 - current)
    }
}
