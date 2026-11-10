import SwiftUI

/// The native Tax estimate route: the household's and each member's estimate, with
/// the tax breakdown, the Medicare levy surcharge what-if and the salary-sacrifice
/// what-if, computed by the shared engine.
struct TaxScreen: View {
    @State private var model: TaxViewModel
    private let planning = PlanningStore.shared

    init(model: TaxViewModel = TaxViewModel(mode: .tax)) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            TaxContentView(content: content)
        }
        .task(id: planning.revision) { await model.load() }
    }
}

struct TaxContentView: View {
    let content: TaxContent

    private var estimate: TaxHouseholdFigures { content.figures.estimate }

    var body: some View {
        TaxPage(title: "Tax estimate (FY\(content.financialYear))") {
            PlanningBanner()
            if estimate.annualGrossCents == 0 {
                Text(
                    "No income to estimate yet. Add a taxable inflow on the Inflows tab to see a tax estimate."
                )
                .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                .frame(maxWidth: .infinity).padding(NestSpacing.xl)
            } else {
                VStack(alignment: .leading, spacing: NestSpacing.sm) {
                    FiguresCard(
                        name: "Household", row: TaxRow(estimate), baseline: content.figures.baseline.map(TaxRow.init))
                    MlsWhatIf(content: content)
                    ForEach(estimate.members, id: \.memberId) { member in
                        MemberFiguresCard(content: content, member: member)
                    }
                    TaxCaption(
                        "Capital gains are counted only for the share and ETF trades recorded on the Investments tab and the equity sales recorded on the Equity tab."
                    )
                }
            }
        }
    }
}

/// The figures a `FiguresCard` headlines, for the household or one member.
struct TaxRow: Equatable, Sendable {
    var annualGrossCents: Int
    var annualTaxCents: Int
    var annualAfterTaxCents: Int
    var annualOneOffGrossCents: Int
    var fortnightlyGrossCents: Int
    var fortnightlyTaxCents: Int
    var fortnightlyAfterTaxCents: Int

    init(_ household: TaxHouseholdFigures) {
        self.init(
            annualGrossCents: household.annualGrossCents, annualTaxCents: household.annualTaxCents,
            annualAfterTaxCents: household.annualAfterTaxCents,
            annualOneOffGrossCents: household.annualOneOffGrossCents,
            fortnightlyGrossCents: household.fortnightlyGrossCents,
            fortnightlyTaxCents: household.fortnightlyTaxCents,
            fortnightlyAfterTaxCents: household.fortnightlyAfterTaxCents)
    }

    init(_ member: TaxMemberFigures) {
        self.init(
            annualGrossCents: member.annualGrossCents, annualTaxCents: member.annualTaxCents,
            annualAfterTaxCents: member.annualAfterTaxCents,
            annualOneOffGrossCents: member.annualOneOffGrossCents,
            fortnightlyGrossCents: member.fortnightlyGrossCents,
            fortnightlyTaxCents: member.fortnightlyTaxCents,
            fortnightlyAfterTaxCents: member.fortnightlyAfterTaxCents)
    }

    init(
        annualGrossCents: Int, annualTaxCents: Int, annualAfterTaxCents: Int,
        annualOneOffGrossCents: Int, fortnightlyGrossCents: Int, fortnightlyTaxCents: Int,
        fortnightlyAfterTaxCents: Int
    ) {
        self.annualGrossCents = annualGrossCents
        self.annualTaxCents = annualTaxCents
        self.annualAfterTaxCents = annualAfterTaxCents
        self.annualOneOffGrossCents = annualOneOffGrossCents
        self.fortnightlyGrossCents = fortnightlyGrossCents
        self.fortnightlyTaxCents = fortnightlyTaxCents
        self.fortnightlyAfterTaxCents = fortnightlyAfterTaxCents
    }
}

private struct MemberFiguresCard: View {
    let content: TaxContent
    let member: TaxMemberFigures

    var body: some View {
        let extras = content.figures.memberExtras.first { $0.memberId == member.memberId }
        let baseline = content.figures.baseline?.members.first { $0.memberId == member.memberId }
        FiguresCard(
            name: content.rows.members.first { $0.id == member.memberId }?.name ?? "Member",
            row: TaxRow(member), baseline: baseline.map(TaxRow.init), member: member,
            baselineBreakdown: baseline?.breakdown,
            projectedInterestCents: extras?.projectedInterestCents ?? 0,
            helpPayoff: extras?.helpPayoff, concessionalCapCents: extras?.capSummary?.concessionalCapCents,
            content: content)
    }
}

/// One member's (or the household's) estimate card, led by the take-home headline,
/// gross and total tax supporting figures and a take-home-versus-tax bar. A member's
/// card adds the withholding position, the build-up and the salary-sacrifice what-if.
struct FiguresCard: View {
    let name: String
    let row: TaxRow
    var baseline: TaxRow?
    var member: TaxMemberFigures?
    var baselineBreakdown: TaxBreakdown?
    var projectedInterestCents = 0
    var helpPayoff: HelpPayoffFigures?
    var concessionalCapCents: Int?
    var content: TaxContent?

    var body: some View {
        TaxCard {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                Text(name).font(.system(size: 16, weight: .semibold)).foregroundStyle(NestColor.text)
                    .accessibilityAddTraits(.isHeader)
                HeroFigures(row: row, baseline: baseline)
                if row.annualOneOffGrossCents > 0 {
                    TaxCaption(
                        "Includes \(MoneyFormat.cents(row.annualOneOffGrossCents)) of one-off money in the annual figures. The fortnightly ones leave it out, so the plan is a statement about the pay that recurs."
                    )
                }
                if let member, member.annualNetCapitalGainCents > 0 {
                    TaxCaption(
                        "Includes \(MoneyFormat.cents(member.annualNetCapitalGainCents)) of net capital gain in the annual figures. The fortnightly ones leave it out."
                    )
                }
                TaxBiteBar(
                    label: name, afterTaxCents: row.annualAfterTaxCents,
                    grossCents: row.annualGrossCents)
                if let member, member.breakdown.paygWithheldCents > 0 {
                    WithholdingPosition(breakdown: member.breakdown, baseline: baselineBreakdown)
                }
                if let helpPayoff { TaxCaption(helpPayoff.summary) }
                if let member {
                    Disclosure(label: "Show breakdown") {
                        VStack(alignment: .leading, spacing: NestSpacing.sm) {
                            TaxWaterfall(member: member)
                            BreakdownTables(
                                member: member, projectedInterestCents: projectedInterestCents)
                        }
                    }
                    if let content {
                        Disclosure(label: "Salary sacrifice what-if") {
                            SalarySacrificePanel(
                                content: content, member: member,
                                concessionalCapCents: concessionalCapCents)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(name)
    }
}

private struct HeroFigures: View {
    let row: TaxRow
    let baseline: TaxRow?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: NestSpacing.md) {
                takeHome
                Spacer(minLength: NestSpacing.md)
                supporting
            }
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                takeHome
                supporting
            }
        }
    }

    private var takeHome: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("TAKE-HOME").font(.system(size: 12)).tracking(0.5)
                .foregroundStyle(NestColor.dimmedText)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                ComparedAmount(
                    baselineCents: baseline?.fortnightlyAfterTaxCents ?? row.fortnightlyAfterTaxCents,
                    proposedCents: row.fortnightlyAfterTaxCents, colouring: false
                )
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(NestColor.text)
                Text("/ fn").font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            }
            HStack(spacing: 4) {
                ComparedAmount(
                    baselineCents: baseline?.annualAfterTaxCents ?? row.annualAfterTaxCents,
                    proposedCents: row.annualAfterTaxCents, colouring: false)
                Text("/ year")
            }
            .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
        }
        .accessibilityElement(children: .combine)
    }

    private var supporting: some View {
        HStack(alignment: .top, spacing: NestSpacing.xl) {
            SupportFigure(
                label: "Gross", fortnightlyCents: row.fortnightlyGrossCents,
                annualCents: row.annualGrossCents)
            SupportFigure(
                label: "Total tax", fortnightlyCents: row.fortnightlyTaxCents,
                annualCents: row.annualTaxCents,
                baselineFortnightlyCents: baseline?.fortnightlyTaxCents,
                baselineAnnualCents: baseline?.annualTaxCents)
        }
    }
}

private struct SupportFigure: View {
    let label: String
    let fortnightlyCents: Int
    let annualCents: Int
    var baselineFortnightlyCents: Int?
    var baselineAnnualCents: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased()).font(.system(size: 12)).tracking(0.5)
                .foregroundStyle(NestColor.dimmedText)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                ComparedAmount(
                    baselineCents: baselineFortnightlyCents ?? fortnightlyCents,
                    proposedCents: fortnightlyCents, colouring: false
                )
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
                Text("/ fn").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            HStack(spacing: 4) {
                ComparedAmount(
                    baselineCents: baselineAnnualCents ?? annualCents, proposedCents: annualCents,
                    colouring: false)
                Text("/ year")
            }
            .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A slim bar splitting gross income into its take-home and tax shares, with a
/// legend naming each as a percentage.
struct TaxBiteBar: View {
    let label: String
    let afterTaxCents: Int
    let grossCents: Int

    var body: some View {
        let split = TaxPresentation.takeHomeSplit(afterTaxCents: afterTaxCents, grossCents: grossCents)
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { proxy in
                HStack(spacing: 0) {
                    NestColor.positive.frame(width: proxy.size.width * CGFloat(split.takeHomePct) / 100)
                    NestColor.negative.frame(width: proxy.size.width * CGFloat(split.taxPct) / 100)
                    Spacer(minLength: 0)
                }
                .background(NestColor.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            }
            .frame(height: 16)
            HStack(spacing: NestSpacing.md) {
                legend(NestColor.positive, "Take-home \(split.takeHomePct)%")
                legend(NestColor.negative, "Tax \(split.taxPct)%")
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(label) take-home versus tax: take-home \(split.takeHomePct)%, tax \(split.taxPct)%")
    }

    private func legend(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: NestRadius.xs).fill(color).frame(width: 10, height: 10)
            Text(text).font(.system(size: 12, weight: .medium)).foregroundStyle(NestColor.dimmedText)
        }
    }
}

/// Where a year's actual withholding sits against the estimated liability.
struct WithholdingPosition: View {
    let breakdown: TaxBreakdown
    var baseline: TaxBreakdown?

    var body: some View {
        let lines = TaxPresentation.withholdingLines(breakdown)
        let balance = breakdown.balanceCents
        let tone = MoneySign(cents: -balance).color ?? NestColor.text
        VStack(alignment: .leading, spacing: 2) {
            Text(lines.withheld).font(.system(size: 14)).foregroundStyle(NestColor.text)
            if let baseline, balance != 0, baseline.balanceCents != balance {
                let sameDirection = (baseline.balanceCents < 0) == (balance < 0) && baseline.balanceCents != 0
                HStack(spacing: 4) {
                    Text("Tracking toward a")
                    ComparedAmount(
                        baselineCents: abs(sameDirection ? baseline.balanceCents : balance),
                        proposedCents: abs(balance), colouring: false)
                    Text(balance < 0 ? "refund." : "bill.")
                }
                .font(.system(size: 14)).foregroundStyle(tone)
            } else {
                Text(lines.tracking).font(.system(size: 14)).foregroundStyle(tone)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// A horizontal waterfall from gross income down to take-home.
struct TaxWaterfall: View {
    let member: TaxMemberFigures

    var body: some View {
        if member.annualGrossCents > 0 {
            let steps = TaxPresentation.waterfallSteps(member)
            let maxCents = Double(steps.map(\.endCents).max() ?? 1)
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                VStack(spacing: 6) {
                    ForEach(steps) { step in
                        HStack(spacing: NestSpacing.sm) {
                            Text(step.label).font(.system(size: 12))
                                .foregroundStyle(NestColor.dimmedText)
                                .lineLimit(1).frame(width: 116, alignment: .leading)
                            GeometryReader { proxy in
                                let left = max(Double(step.startCents) / maxCents, 0)
                                let width = max(Double(step.endCents - step.startCents) / maxCents, 0.005)
                                RoundedRectangle(cornerRadius: NestRadius.xs)
                                    .fill(color(step))
                                    .frame(width: proxy.size.width * width)
                                    .offset(x: proxy.size.width * left)
                            }
                            .frame(height: 14)
                            Group {
                                if !step.isEndpoint {
                                    MoneyText(
                                        cents: step.increase ? step.amountCents : -step.amountCents,
                                        colouring: false
                                    )
                                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                                }
                            }
                            .frame(width: 84, alignment: .trailing)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(step.label): \(MoneyFormat.cents(step.amountCents))")
                    }
                }
                if steps.contains(where: { $0.key == "deductions" }) {
                    TaxCaption("Deductions lower taxable income and tax, not the cash you keep.")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Income build-up")
        }
    }

    private func color(_ step: WaterfallStep) -> Color {
        switch step.kind {
        case .income, .result: NestColor.positive
        case .superannuation: ChartColorKey.sacrifice.color
        case .deduction: ChartColorKey.buffer.color
        case .tax: ChartColorKey.tax.color
        }
    }
}

/// How a member's gross income becomes taxable income, then how the tax builds up.
struct BreakdownTables: View {
    let member: TaxMemberFigures
    let projectedInterestCents: Int

    var body: some View {
        let income = TaxPresentation.incomeLines(
            member: member, projectedInterestCents: projectedInterestCents)
        let tax = TaxPresentation.taxLines(member.breakdown)
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            ComponentTable(label: "Taxable income", lines: income.filter(\.isVisible))
            if member.annualOneOffGrossCents > 0 {
                TaxCaption(
                    "Gross income includes \(MoneyFormat.cents(member.annualOneOffGrossCents)) of one-off payments. The card’s fortnightly figures leave them out — money that lands once has no fortnightly share of its own."
                )
            }
            ComponentTable(label: "Tax breakdown", lines: tax.filter(\.isVisible))
            let omitted = tax.filter { !$0.isVisible }
            if !omitted.isEmpty {
                TaxCaption("Not applicable this year: \(omitted.map(\.label).joined(separator: ", ")).")
            }
        }
    }
}

private struct ComponentTable: View {
    let label: String
    let lines: [BreakdownLine]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Text("Annual").frame(width: 96, alignment: .trailing)
                Text("Fortnightly").frame(width: 96, alignment: .trailing)
            }
            .font(.system(size: 12, weight: .semibold)).foregroundStyle(NestColor.dimmedText)
            .padding(.vertical, 6)
            ForEach(lines) { line in
                Divider().overlay(NestColor.border)
                HStack(alignment: .firstTextBaseline) {
                    Text(line.label)
                        .fontWeight(line.total ? .bold : .regular)
                        .foregroundStyle(line.total ? NestColor.text : NestColor.dimmedText)
                        .padding(.leading, line.detail ? NestSpacing.md : 0)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    MoneyText(cents: line.signedAnnualCents, colouring: false)
                        .fontWeight(line.total ? .bold : .regular)
                        .frame(width: 96, alignment: .trailing)
                    MoneyText(cents: line.fortnightlyCents, colouring: false)
                        .fontWeight(line.total ? .bold : .regular)
                        .frame(width: 96, alignment: .trailing)
                }
                .font(.system(size: 13)).padding(.vertical, 6)
                .accessibilityElement(children: .combine)
            }
        }
        .accessibilityLabel(label)
    }
}

/// An interactive salary-sacrifice what-if for one member.
private struct SalarySacrificePanel: View {
    let content: TaxContent
    let member: TaxMemberFigures
    let concessionalCapCents: Int?
    @State private var extraCents = 0
    @State private var result: SalarySacrificeResult?

    var body: some View {
        WhatIfPanel(title: "Salary sacrifice") {
            DollarField(label: "Extra salary sacrifice per year", cents: $extraCents)
            if extraCents > 0, let result {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text("Tax saved:")
                        MoneyText(cents: result.taxSavedCents)
                        Text("/ year")
                    }
                    HStack(spacing: 4) {
                        Text("Into super:")
                        MoneyText(cents: result.netToSuperCents, colouring: false)
                        Text("/ year")
                        Text("(net of 15% contributions tax)").foregroundStyle(NestColor.dimmedText)
                    }
                    HStack(spacing: 4) {
                        Text("Take-home:")
                        MoneyText(cents: result.takeHomeChangeCents)
                        Text("/ year")
                    }
                    if result.division293DeltaCents > 0 {
                        TaxCaption(
                            "Includes \(MoneyFormat.cents(result.division293DeltaCents)) extra Division 293 tax."
                        )
                    }
                    if let cap = concessionalCapCents,
                        member.annualConcessionalContributionsCents + extraCents > cap
                    {
                        TaxAlert(
                            text:
                                "This pushes concessional contributions past the cap (\(MoneyFormat.cents(cap))). The excess is taxed at your marginal rate, not 15%."
                        )
                    }
                }
                .font(.system(size: 14)).foregroundStyle(NestColor.text)
            }
        }
        .task(id: extraCents) {
            guard extraCents > 0 else { result = nil; return }
            result = try? await content.engine.salarySacrifice(
                SalarySacrificeInput(
                    rows: content.input, memberId: member.memberId, extraCents: extraCents))
        }
    }
}

/// A household-level Medicare levy surcharge what-if: the surcharge as if no member
/// held private hospital cover, against an entered annual premium.
struct MlsWhatIf: View {
    let content: TaxContent
    @State private var dependentChildren = 0
    @State private var premiumCents = 0
    @State private var result: FamilyMlsFigures?

    var body: some View {
        Disclosure(label: "Private hospital cover what-if") {
            WhatIfPanel(title: "Private hospital cover vs the Medicare levy surcharge") {
                HStack(alignment: .top, spacing: NestSpacing.sm) {
                    CountField(label: "Dependent children", value: $dependentChildren)
                    DollarField(label: "Hospital cover premium ($/yr)", cents: $premiumCents)
                }
                if let result {
                    let lines = TaxPresentation.coverLines(result, premiumCents: premiumCents)
                    Text(lines.surcharge).font(.system(size: 14))
                        .foregroundStyle(result.tierRate == 0 ? NestColor.dimmedText : NestColor.text)
                    if let saving = lines.saving {
                        Text(saving).font(.system(size: 14))
                            .foregroundStyle(MoneySign(cents: lines.savingCents).color ?? NestColor.text)
                    }
                }
            }
        }
        .task(id: dependentChildren) {
            result = try? await content.engine.mls(
                DependentChildrenInput(rows: content.input, dependentChildren: dependentChildren))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Private hospital cover")
    }
}
