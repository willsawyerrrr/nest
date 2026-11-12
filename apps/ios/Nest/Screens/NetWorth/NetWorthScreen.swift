import SwiftUI

/// The native Net worth route: assets less liabilities, the projection forward,
/// and the accounts behind them, computed by the shared engine.
struct NetWorthScreen: View {
    @State private var model: NetWorthViewModel
    private let planning = PlanningStore.shared

    init(model: NetWorthViewModel = NetWorthViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            NetWorthContentView(model: model, content: content)
        }
        .task(id: planning.revision) { await model.load() }
    }
}

struct NetWorthContentView: View {
    @Bindable var model: NetWorthViewModel
    let content: NetWorthContent
    @State private var editing = false

    private var presentation: NetWorthPresentation { .init(content: content) }
    private var breakdown: NetWorthOutcome.Breakdown { presentation.breakdown }

    var body: some View {
        NestPageSection(title: "Net worth") {
            PlanningBanner()
            if presentation.hasTogglable { editButton }
            if let error = model.actionError {
                Text(error.userMessage).font(NestFont.caption).foregroundStyle(NestColor.negative)
            }
            totalCard
            ProjectionCard(model: model, presentation: presentation)
            AccountGroup(
                title: "Super", symbol: "building.columns", color: .superannuation,
                accounts: breakdown.superAccounts, subtotalCents: breakdown.superTotalCents,
                emptyLabel: NetWorthPresentation.superEmpty, excluded: false, editing: false,
                collapsible: false, onToggle: { _, _ in })
            AccountGroup(
                title: "Other accounts", symbol: "wallet.pass", color: .cash,
                accounts: breakdown.otherAccounts, subtotalCents: breakdown.otherTotalCents,
                emptyLabel: NetWorthPresentation.otherEmpty, excluded: false, editing: editing,
                collapsible: false, onToggle: toggle)
            if !breakdown.equityHoldings.isEmpty { equityGroup }
            if !breakdown.liabilities.isEmpty { liabilityGroup }
            if !breakdown.excludedAccounts.isEmpty {
                AccountGroup(
                    title: "Excluded from net worth", symbol: "eye.slash", color: .excluded,
                    accounts: breakdown.excludedAccounts, subtotalCents: nil, emptyLabel: "",
                    excluded: true, editing: editing, collapsible: true, onToggle: toggle)
            }
        }
    }

    private func toggle(_ id: String, _ exclude: Bool) {
        Task { await model.setExcluded(exclude, accountID: id) }
    }

    private var editButton: some View {
        HStack {
            Spacer()
            Button {
                editing.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: editing ? "checkmark" : "pencil").font(.system(size: 12, weight: .semibold))
                    Text(editing ? "Done" : "Edit").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(editing ? NestColor.onBrand : NestColor.navActiveText)
                .padding(.horizontal, NestSpacing.sm)
                .padding(.vertical, 6)
                .background(
                    editing ? NestColor.brand : NestColor.brand.opacity(0.16),
                    in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("net-worth-edit")
        }
    }

    private var totalCard: some View {
        NestCard {
            VStack(spacing: 0) {
                Text("Total net worth").font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                ComparedAmount(
                    baselineCents: presentation.baselineTotalCents, proposedCents: presentation.totalCents
                )
                .font(.system(size: 20, weight: .bold))
                .accessibilityIdentifier("net-worth-total")
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
    }

    private var equityGroup: some View {
        GroupCard(
            title: "Equity", symbol: "chart.pie", color: .equity, subtotalCents: breakdown.equityTotalCents,
            colouring: false
        ) {
            ForEach(breakdown.equityHoldings) { holding in
                AccountRow(name: holding.label, cents: holding.valueCents, colouring: false)
            }
            Text(NetWorthPresentation.equityNote).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
        }
    }

    private var liabilityGroup: some View {
        GroupCard(
            title: "Liabilities", symbol: "receipt", color: .liability,
            subtotalCents: -breakdown.liabilitiesTotalCents, colouring: true
        ) {
            ForEach(breakdown.liabilities) { liability in
                AccountRow(name: liability.label, cents: -liability.balanceCents, colouring: true)
            }
        }
    }
}

/// A section header's category glyph: a small tinted symbol, muted when excluded.
private struct SectionAccent: View {
    let symbol: String
    let color: NetWorthColor
    var dimmed = false

    var body: some View {
        let tint = dimmed ? NetWorthColor.excluded.color : color.color
        Image(systemName: symbol)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: 22, height: 22)
            .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: NestRadius.sm, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A bordered section: glyph and title with a bold subtotal, over its rows.
private struct GroupCard<Rows: View>: View {
    let title: String
    let symbol: String
    let color: NetWorthColor
    var subtotalCents: Int?
    var colouring = false
    var dimmed = false
    @ViewBuilder var rows: Rows

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                GroupHeader(
                    title: title, symbol: symbol, color: color, subtotalCents: subtotalCents,
                    colouring: colouring, dimmed: dimmed, chevron: nil)
                rows
            }
        }
        .opacity(dimmed ? 0.7 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

private struct GroupHeader: View {
    let title: String
    let symbol: String
    let color: NetWorthColor
    let subtotalCents: Int?
    var colouring = false
    var dimmed = false
    let chevron: Bool?

    var body: some View {
        HStack(spacing: NestSpacing.xs) {
            if let chevron {
                Image(systemName: chevron ? "chevron.down" : "chevron.right")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
            }
            SectionAccent(symbol: symbol, color: color, dimmed: dimmed)
            Text(title).font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(dimmed ? NestColor.dimmedText : NestColor.text).lineLimit(1)
            Spacer(minLength: NestSpacing.xs)
            if let subtotalCents {
                MoneyText(cents: subtotalCents, colouring: colouring).font(.system(size: 15, weight: .bold))
            }
        }
        .contentShape(Rectangle())
    }
}

/// One dense row: the name, then the figure, over a hairline rule.
private struct AccountRow<Trailing: View>: View {
    let name: String
    let cents: Int
    var colouring = false
    var isDeleted = false
    @ViewBuilder var trailing: Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: NestSpacing.sm) {
                Text(name).font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
                    .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                if isDeleted { NestPill(text: "Deleted at source", tone: .warning) }
                MoneyText(cents: cents, colouring: colouring).font(.system(size: 14))
                trailing
            }
            if isDeleted {
                Text("Deleted at source.").font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }
}

extension AccountRow where Trailing == EmptyView {
    fileprivate init(name: String, cents: Int, colouring: Bool = false) {
        self.init(name: name, cents: cents, colouring: colouring) { EmptyView() }
    }
}

/// A labelled group of accounts with per-account balances and, when
/// `subtotalCents` is given, a subtotal; each row carries an include or exclude
/// control while `editing`.
private struct AccountGroup: View {
    let title: String
    let symbol: String
    let color: NetWorthColor
    let accounts: [NetWorthOutcome.Account]
    let subtotalCents: Int?
    let emptyLabel: String
    let excluded: Bool
    let editing: Bool
    let collapsible: Bool
    let onToggle: (String, Bool) -> Void
    @State private var isOpen = false

    private var showsBody: Bool { !collapsible || isOpen }

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                if collapsible {
                    Button { isOpen.toggle() } label: {
                        GroupHeader(
                            title: title, symbol: symbol, color: color, subtotalCents: subtotalCents,
                            dimmed: excluded, chevron: isOpen)
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(isOpen ? "Expanded" : "Collapsed")
                } else {
                    GroupHeader(
                        title: title, symbol: symbol, color: color, subtotalCents: subtotalCents,
                        dimmed: excluded, chevron: nil)
                }
                if showsBody {
                    if accounts.isEmpty {
                        NestEmptyState(text: emptyLabel)
                    } else {
                        ForEach(accounts) { account in
                            AccountRow(
                                name: account.name, cents: account.balanceCents,
                                isDeleted: account.deletedFromSourceAt != nil
                            ) {
                                if editing && color != .superannuation {
                                    Button { onToggle(account.id, !excluded) } label: {
                                        Image(systemName: excluded ? "eye.slash" : "eye")
                                            .foregroundStyle(NestColor.dimmedText)
                                            .frame(width: 28, height: 28)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(
                                        excluded
                                            ? "Include \(account.name) in net worth"
                                            : "Exclude \(account.name) from net worth")
                                }
                            }
                        }
                    }
                }
            }
        }
        .opacity(excluded ? 0.7 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}
