import SwiftUI

/// The native Breakdowns route: the household's breakdowns with their rolled-up
/// totals, each pushing its detail. Both levels read one view model.
struct BreakdownsScreen: View {
    @State private var model: BreakdownsViewModel

    init(model: BreakdownsViewModel = BreakdownsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            BreakdownsListView(presentation: BreakdownsPresentation(content: content))
        }
        .task { await model.load() }
    }
}

/// A breakdown's id, the value pushed to open its detail.
private struct BreakdownID: Hashable {
    let id: String
}

struct BreakdownsListView: View {
    let presentation: BreakdownsPresentation

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                Text("A breakdown is an itemised list whose items roll up into a single budget item.")
                    .font(NestFont.caption)
                    .foregroundStyle(NestColor.dimmedText)
                if presentation.rows.isEmpty {
                    Text("No breakdowns yet.")
                        .foregroundStyle(NestColor.dimmedText)
                        .frame(maxWidth: .infinity)
                        .padding(NestSpacing.xl)
                } else {
                    ForEach(presentation.rows) { row in
                        NavigationLink(value: BreakdownID(id: row.id)) {
                            BreakdownCard(row: row)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(NestSpacing.md)
        }
        .navigationDestination(for: BreakdownID.self) { target in
            BreakdownDetailView(detail: presentation.detail(id: target.id))
        }
    }
}

private struct BreakdownCard: View {
    let row: BreakdownRow

    var body: some View {
        NestCard {
            HStack(spacing: NestSpacing.sm) {
                VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                    Text(row.name).font(NestFont.body).fontWeight(.semibold)
                        .foregroundStyle(NestColor.text)
                    HStack(spacing: NestSpacing.xs) {
                        Circle().fill(row.color.color).frame(width: 8, height: 8)
                        NestPill(text: row.groupLabel)
                    }
                }
                Spacer(minLength: NestSpacing.sm)
                VStack(alignment: .trailing, spacing: NestSpacing.xxs) {
                    MoneyText(cents: Int(row.fortnightlyCents), colouring: false)
                        .font(NestFont.body).fontWeight(.semibold)
                    Text(MoneyFormat.perYear(Int(row.annualCents)))
                        .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                }
                Image(systemName: "chevron.right").foregroundStyle(NestColor.dimmedText)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// One breakdown: its items and the fortnightly and annual totals they roll up to.
struct BreakdownDetailView: View {
    let detail: BreakdownDetail?

    var body: some View {
        if let detail {
            ScrollView {
                VStack(alignment: .leading, spacing: NestSpacing.sm) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Items").font(NestFont.heading).foregroundStyle(NestColor.text)
                        Spacer()
                        Text(MoneyFormat.perFortnight(Int(detail.row.fortnightlyCents)))
                            .fontWeight(.bold).monospacedDigit()
                            .foregroundStyle(NestColor.text)
                            .accessibilityLabel("Breakdown fortnightly total")
                    }
                    Text("Rolls up to \(MoneyFormat.perYear(Int(detail.row.annualCents))).")
                        .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    if detail.items.isEmpty {
                        Text("No items yet.")
                            .foregroundStyle(NestColor.dimmedText)
                            .frame(maxWidth: .infinity)
                            .padding(NestSpacing.xl)
                    } else {
                        ForEach(detail.items) { ItemCard(item: $0) }
                    }
                }
                .padding(NestSpacing.md)
            }
            .navigationTitle(detail.row.name)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
        } else {
            ErrorView(
                title: "Breakdown not found",
                message: NestError(.notFound).userMessage)
        }
    }
}

private struct ItemCard: View {
    let item: BreakdownItemRow

    var body: some View {
        NestCard {
            HStack(spacing: NestSpacing.sm) {
                VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                    Text(item.name).font(NestFont.body).fontWeight(.semibold)
                        .foregroundStyle(NestColor.text)
                    HStack(spacing: NestSpacing.xs) {
                        MoneyText(cents: item.amountCents, colouring: false)
                            .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                        NestPill(text: item.frequencyLabel)
                    }
                }
                Spacer(minLength: NestSpacing.sm)
                MoneyText(cents: Int(item.fortnightlyCents), colouring: false)
                    .font(NestFont.body).fontWeight(.semibold)
                Text("/ fn").font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
