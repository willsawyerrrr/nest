import SwiftUI

/// The native Budget route: budget lines by group with the engine's fortnightly
/// subtotals, each member's allowance, and temporary items.
struct BudgetScreen: View {
    @State private var model: BudgetViewModel
    private let planning = PlanningStore.shared

    init(model: BudgetViewModel = BudgetViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            BudgetContentView(presentation: BudgetPresentation(content: content))
        }
        .task(id: planning.revision) { await model.load() }
    }
}

struct BudgetContentView: View {
    let presentation: BudgetPresentation

    var body: some View {
        NestPageSection(title: "Budget") {
            PlanningBanner()
            ForEach(presentation.groups) { section in
                GroupCard(section: section) {
                    if section.group == .discretionary {
                        AllowancesBlock(rows: presentation.allowances)
                    }
                }
            }
            if !presentation.temporaryItems.isEmpty {
                TemporaryCard(items: presentation.temporaryItems)
            }
            WebHandoffCard(
                title: "Edit budget",
                message: "Adding and changing budget items happens in the web app.",
                action: "Open Budget on the web", path: Route.budget.path)
        }
    }
}

private struct GroupCard<Header: View>: View {
    let section: BudgetGroupSection
    @ViewBuilder var header: Header

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(section.title).font(NestFont.heading).foregroundStyle(NestColor.text)
                    Spacer()
                    Text(MoneyFormat.perFortnight(Int(section.subtotalCents)))
                        .font(.system(size: 15, weight: .bold)).monospacedDigit()
                        .foregroundStyle(NestColor.text)
                        .accessibilityLabel(
                            "\(section.title) fortnightly subtotal \(MoneyFormat.cents(Int(section.subtotalCents)))"
                        )
                }
                header
                if section.lines.isEmpty {
                    NestEmptyState(text: "No \(section.title.lowercased()) items yet.")
                }
                ForEach(section.lines) { BudgetLineRowView(row: $0) }
            }
        }
    }
}

struct BudgetLineRowView: View {
    let row: BudgetLineRow

    var body: some View {
        NestListRow(
            title: row.name,
            subtitle: [row.cadence, row.route].compactMap { $0 }.joined(separator: " · ")
        ) {
            VStack(alignment: .trailing, spacing: NestSpacing.xxs) {
                MoneyText(cents: row.amountCents, colouring: false).font(NestFont.body)
                Text(MoneyFormat.perFortnight(Int(row.fortnightlyCents)))
                    .font(NestFont.caption).monospacedDigit()
                    .foregroundStyle(NestColor.dimmedText)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct AllowancesBlock: View {
    let rows: [AllowanceRow]

    var body: some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                Text("Spending allowances").font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text)
                Text("An amount each person can spend on themselves. \(BudgetPresentation.allowanceNote)")
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                ForEach(rows) { row in
                    if row.isOwn {
                        NavigationLink(value: Route.allowance) { AllowanceRowView(row: row) }
                            .buttonStyle(.plain)
                    } else {
                        AllowanceRowView(row: row)
                    }
                }
            }
        }
    }
}

struct AllowanceRowView: View {
    let row: AllowanceRow
    var showsTitle = true

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            HStack {
                if showsTitle {
                    Text(row.title).font(NestFont.body).foregroundStyle(NestColor.text)
                }
                Spacer()
                if row.isOwn {
                    Image(systemName: "chevron.right").font(.caption)
                        .foregroundStyle(NestColor.dimmedText)
                }
            }
            Text(
                "\(MoneyFormat.cents(row.amountCents)) \(row.cadence.lowercased()) (\(MoneyFormat.perFortnight(Int(row.fortnightlyCents))))"
            )
            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            if let drawn = row.drawnCents, let remaining = row.remainingCents {
                ProgressView(value: row.usedFraction).tint(NestColor.positive)
                HStack {
                    Text("Drawn \(MoneyFormat.perFortnight(Int(drawn)))")
                    Spacer()
                    Text("Left \(MoneyFormat.cents(Int(max(0, remaining))))")
                }
                .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        }
        .padding(NestSpacing.xs)
        .background(
            NestColor.surfaceRaised,
            in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct TemporaryCard: View {
    let items: [TemporaryRow]

    var body: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                Text("Temporary items").font(NestFont.heading).foregroundStyle(NestColor.text)
                ForEach(items) { item in
                    NestListRow(
                        title: item.name,
                        subtitle: "until \(BudgetPresentation.date(item.targetDate))"
                    ) {
                        HStack(spacing: NestSpacing.xs) {
                            NestPill(
                                text: item.isActive ? "Active" : "Expired",
                                tone: item.isActive ? .positive : .neutral)
                            MoneyText(cents: item.contributionCents, colouring: false)
                                .font(NestFont.body)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}
