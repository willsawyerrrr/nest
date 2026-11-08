import Charts
import SwiftUI

/// The native Summary route: the reconciliation ledger, allocation donut,
/// allowance progress and one-off money, computed by the shared engine.
struct SummaryScreen: View {
    @State private var model: SummaryViewModel
    private let planning = PlanningStore.shared

    init(model: SummaryViewModel = SummaryViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            SummaryContentView(content: content, basis: $model.basis)
        }
        .task(id: planning.revision) { await model.load() }
    }
}

struct SummaryContentView: View {
    let content: SummaryContent
    @Binding var basis: IncomeBasis
    @State private var showsCashFlow = false

    private var presentation: SummaryPresentation { .init(summary: content.summary) }

    var body: some View {
        ScrollView {
            VStack(spacing: NestSpacing.md) {
                PlanningBanner()
                if presentation.hasData {
                    AllocationCard(presentation: presentation, basis: $basis)
                    AllowanceCard(summary: content.summary, members: content.members)
                    cashFlowCard
                    LedgerCard(
                        presentation: presentation, baseline: content.baseline.map(SummaryPresentation.init),
                        basis: basis)
                    if content.summary.oneOffCents != 0 {
                        Text(
                            "\(MoneyFormat.cents(Int(content.summary.oneOffCents))) of one-off money lands this financial year — severance, a bonus, a gift. It is left out of every figure above, because money that arrives once has no fortnightly share to plan against."
                        )
                        .font(NestFont.caption)
                        .foregroundStyle(NestColor.dimmedText)
                        .accessibilityIdentifier("one-off-note")
                    }
                } else {
                    Text(
                        "Nothing to reconcile yet. Add inflows and budget items to see how your money is allocated."
                    )
                    .foregroundStyle(NestColor.dimmedText)
                    .multilineTextAlignment(.center)
                    .padding(NestSpacing.xl)
                }
            }
            .padding(NestSpacing.md)
        }
        .sheet(isPresented: $showsCashFlow) {
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Done") { showsCashFlow = false }.padding(NestSpacing.md)
                }
                WebRouteView(path: Route.summary.path)
            }
        }
    }

    private var cashFlowCard: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                Text("Fortnightly cash flow").font(NestFont.heading).foregroundStyle(NestColor.text)
                Text("The cash-flow diagram is drawn by the web app.")
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                Button("View cash flow") { showsCashFlow = true }
            }
        }
    }
}

private struct AllocationCard: View {
    let presentation: SummaryPresentation
    @Binding var basis: IncomeBasis

    var body: some View {
        let segments = presentation.segments(basis)
        let summary = presentation.summary
        if !segments.isEmpty {
            NestCard {
                VStack(spacing: NestSpacing.md) {
                    HStack {
                        Text("Fortnightly allocation").font(NestFont.heading)
                            .foregroundStyle(NestColor.text)
                        Spacer()
                        Picker("Income basis", selection: $basis) {
                            ForEach(IncomeBasis.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        .frame(maxWidth: 200)
                    }
                    Chart(segments) { segment in
                        SectorMark(
                            angle: .value("Amount", Double(segment.cents)),
                            innerRadius: .ratio(0.62), angularInset: 1
                        )
                        .foregroundStyle(segment.color.color)
                    }
                    .chartLegend(.hidden)
                    .frame(width: 180, height: 180)
                    .overlay {
                        VStack(spacing: 0) {
                            MoneyText(cents: Int(summary.afterSaving.fortnightlyCents))
                                .font(NestFont.heading)
                            Text("buffer").font(NestFont.caption)
                                .foregroundStyle(NestColor.dimmedText)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(
                        "Allocation, \(MoneyFormat.cents(Int(summary.afterSaving.fortnightlyCents))) buffer")

                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3)) {
                        if basis == .gross {
                            tile("Gross", presentation.gross.fortnightlyCents)
                            tile("Tax", summary.tax.fortnightlyCents)
                            tile("Salary sacrifice", summary.salarySacrifice.fortnightlyCents)
                        }
                        tile("Income", summary.available.fortnightlyCents)
                        tile("Outgoing", summary.outgoings.fortnightlyCents)
                        tile("Remaining", summary.afterSaving.fortnightlyCents, signed: true)
                    }

                    VStack(spacing: NestSpacing.xxs) {
                        ForEach(segments) { segment in
                            HStack(spacing: NestSpacing.xs) {
                                Circle().fill(segment.color.color).frame(width: 12, height: 12)
                                Text(segment.name).font(NestFont.body)
                                    .foregroundStyle(NestColor.text)
                                Spacer()
                                Text(SummaryPresentation.percent(segment.portion))
                                    .font(NestFont.body).monospacedDigit()
                                    .foregroundStyle(NestColor.dimmedText)
                            }
                        }
                    }
                }
            }
        }
    }

    private func tile(_ label: String, _ cents: Int64, signed: Bool = false) -> some View {
        VStack(spacing: 0) {
            Text(label).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            MoneyText(cents: Int(cents), colouring: signed).font(.system(size: 15, weight: .bold))
        }
    }
}

private struct AllowanceCard: View {
    let summary: BudgetSummary
    let members: [Member]

    var body: some View {
        if !summary.allowances.isEmpty {
            NestCard {
                VStack(alignment: .leading, spacing: NestSpacing.sm) {
                    Text("Allowances").font(NestFont.heading).foregroundStyle(NestColor.text)
                    ForEach(summary.allowances, id: \.memberId) { allowance in
                        let name = members.first { $0.id == allowance.memberId }?.name ?? "Member"
                        let total = Double(allowance.allowance.fortnightlyCents)
                        let drawn = Double(allowance.drawn.fortnightlyCents)
                        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                            HStack {
                                Text("\(name)’s allowance").font(NestFont.body)
                                    .foregroundStyle(NestColor.text)
                                Spacer()
                                MoneyText(cents: Int(allowance.remaining.fortnightlyCents))
                                    .font(NestFont.body)
                            }
                            ProgressView(value: total > 0 ? min(drawn / total, 1) : 0)
                                .tint(allowance.remaining.fortnightlyCents < 0 ? NestColor.negative : NestColor.brand)
                            Text(
                                "\(MoneyFormat.perFortnight(Int(allowance.drawn.fortnightlyCents))) drawn of \(MoneyFormat.perFortnight(Int(allowance.allowance.fortnightlyCents)))"
                            )
                            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                        }
                    }
                }
            }
        }
    }
}

private struct LedgerCard: View {
    let presentation: SummaryPresentation
    /// The real rows' presentation while planning mode is on.
    let baseline: SummaryPresentation?
    let basis: IncomeBasis

    private func baselineCents(_ row: LedgerRow) -> Int? {
        baseline?.ledger(basis).first { $0.id == row.id }.map { Int($0.amounts.fortnightlyCents) }
    }

    var body: some View {
        NestCard {
            VStack(spacing: NestSpacing.xxs) {
                ForEach(presentation.ledger(basis)) { row in
                    HStack(spacing: NestSpacing.sm) {
                        Text(row.label)
                            .font(.system(size: 15, weight: row.running ? .bold : .regular))
                            .foregroundStyle(NestColor.text)
                        Spacer(minLength: NestSpacing.sm)
                        ComparedAmount(
                            baselineCents: baselineCents(row),
                            proposedCents: Int(row.amounts.fortnightlyCents), colouring: row.signed
                        )
                        .font(.system(size: 15, weight: .bold))
                        Text(
                            SummaryPresentation.percent(
                                presentation.portion(of: row.amounts.fortnightlyCents, basis: basis))
                        )
                        .font(.system(size: 12, weight: .bold)).monospacedDigit()
                        .foregroundStyle(NestColor.dimmedText)
                        .frame(width: 56, alignment: .trailing)
                    }
                    .padding(NestSpacing.xs)
                    .background(
                        row.running ? NestColor.brand.opacity(0.12) : .clear,
                        in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}
