import SwiftUI

/// The native Investments route: each member's holdings, realised gains and trades,
/// with add, edit and delete. Reading trades from a contract note stays in the web app.
struct InvestmentsScreen: View {
    @State private var model: InvestmentsViewModel

    init(model: InvestmentsViewModel = InvestmentsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            InvestmentsContentView(model: model, presentation: InvestmentsPresentation(content: content))
        }
        .task { await model.load() }
    }
}

/// What the inline form is doing.
private enum TradeEditing: Equatable {
    case none
    case adding(memberID: String)
    case editing(String)
}

struct InvestmentsContentView: View {
    let model: InvestmentsViewModel
    let presentation: InvestmentsPresentation

    @State private var editing = TradeEditing.none
    @State private var deleting: InvestmentsPresentation.TradeItem?
    @State private var deleteFailed = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        NestPageSection(title: InvestmentsPresentation.title, intro: InvestmentsPresentation.intro) {
                ForEach(presentation.sections) { section in
                    InvestmentsMemberSection(
                        section: section, presentation: presentation, editing: $editing,
                        model: model, onDelete: { deleting = $0 }, onDocument: open)
                }
                WebHandoffCard(
                    title: InvestmentsPresentation.handoffTitle,
                    message: InvestmentsPresentation.handoffMessage,
                    action: InvestmentsPresentation.handoffAction, path: Route.investments.path)
        }
        .alert(
            InvestmentsPresentation.deleteTitle,
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { trade in
            Button("Delete", role: .destructive) {
                Task {
                    do { try await model.remove(id: trade.id) } catch { deleteFailed = true }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: { trade in
            Text("Delete \(trade.deleteLabel)? This cannot be undone.")
        }
        .alert("Couldn't delete", isPresented: $deleteFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Something went wrong. Try again.")
        }
    }

    private func open(_ path: String) {
        Task { if let url = try? await model.documentURL(path: path) { openURL(url) } }
    }
}

private struct InvestmentsSectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12)).tracking(0.48).foregroundStyle(NestColor.dimmedText)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct InvestmentsMemberSection: View {
    let section: InvestmentsPresentation.Section
    let presentation: InvestmentsPresentation
    @Binding var editing: TradeEditing
    let model: InvestmentsViewModel
    let onDelete: (InvestmentsPresentation.TradeItem) -> Void
    let onDocument: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text(section.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(NestColor.text)
            if !section.holdings.isEmpty {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    InvestmentsSectionLabel(text: "Holdings")
                    ForEach(section.holdings, id: \.title) { SummaryRow(line: $0) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("\(section.name)'s holdings")
            }
            if !section.gains.isEmpty {
                VStack(alignment: .leading, spacing: NestSpacing.xs) {
                    InvestmentsSectionLabel(text: "Realised gains")
                    ForEach(section.gains, id: \.title) { SummaryRow(line: $0) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("\(section.name)'s realised gains")
            }
            ForEach(section.unmatched, id: \.self) {
                Text($0).font(.system(size: 12)).foregroundStyle(NestColor.negative)
            }
            InvestmentsSectionLabel(text: "Trades")
            if section.trades.isEmpty && editing != .adding(memberID: section.memberID) {
                NestEmptyState(text: InvestmentsPresentation.emptyMessage)
            }
            ForEach(section.trades) { trade in
                if editing == .editing(trade.id), let row = model.state.value?.rows.trades.first(where: { $0.id == trade.id }) {
                    TradeForm(
                        memberID: section.memberID, editing: row, presentation: presentation,
                        figures: { await model.figures(for: $0) },
                        onSubmit: { input in
                            try await model.save(input, id: trade.id)
                            editing = .none
                        },
                        onCancel: { editing = .none })
                } else {
                    TradeItemView(
                        trade: trade, onEdit: { editing = .editing(trade.id) },
                        onDelete: { onDelete(trade) }, onDocument: onDocument)
                }
            }
            if editing == .adding(memberID: section.memberID) {
                TradeForm(
                    memberID: section.memberID, editing: nil, presentation: presentation,
                    figures: { await model.figures(for: $0) },
                    onSubmit: { input in
                        try await model.save(input)
                        editing = .none
                    },
                    onCancel: { editing = .none })
            } else {
                AddButton(label: InvestmentsPresentation.addLabel) {
                    editing = .adding(memberID: section.memberID)
                }
            }
        }
    }
}

private struct SummaryRow: View {
    let line: InvestmentsPresentation.Line

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    private var figure: some View {
        VStack(alignment: .trailing, spacing: 0) {
            MoneyText(cents: line.figureCents)
                .font(.system(size: 14, weight: .bold))
            Text(line.caption).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
        }
        .fixedSize()
    }

    var body: some View {
        if wide {
            HStack(spacing: NestSpacing.sm) {
                Text(line.title).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(NestColor.text).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ForEach(Array(line.cells.enumerated()), id: \.offset) { _, cell in
                    Text(cell).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                        .frame(width: 136, alignment: .trailing)
                }
                figure
            }
            .padding(.vertical, 6)
            .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
        } else {
            NestCard(padding: NestSpacing.xs) {
                HStack(alignment: .center, spacing: NestSpacing.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(line.title).font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(NestColor.text).lineLimit(1)
                        Text(line.cells.filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    }
                    Spacer(minLength: 0)
                    figure
                }
            }
        }
    }
}

/// The side pill: a small, light-tinted badge (cyan for a buy, orange for a sell).
private struct SideBadge: View {
    let side: TradeSide

    var body: some View {
        let colour = side == .buy ? Color.cyan : Color.orange
        Text((side == .buy ? "Buy" : "Sell").uppercased())
            .font(.system(size: 10, weight: .bold)).foregroundStyle(colour)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(colour.opacity(0.16), in: Capsule())
            .fixedSize()
    }
}

private struct IconButton: View {
    let systemImage: String
    let label: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage).font(.system(size: 14))
                .foregroundStyle(tint).frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

private struct TradeItemView: View {
    let trade: InvestmentsPresentation.TradeItem
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onDocument: (String) -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
        private var wide: Bool { sizeClass != .compact }
    #else
        private let wide = true
    #endif

    private func muted(_ text: String, width: CGFloat) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            .lineLimit(1).frame(width: width, alignment: .trailing)
    }

    private var title: some View {
        HStack(spacing: 6) {
            SideBadge(side: trade.side)
            Text(trade.ticker).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.text).lineLimit(1).fixedSize()
        }
    }

    private var value: some View {
        MoneyText(cents: trade.valueCents).font(.system(size: 14, weight: .bold))
    }

    var body: some View {
        if wide { rowBody } else { cardBody }
    }

    private var rowBody: some View {
        HStack(spacing: NestSpacing.sm) {
            title.frame(maxWidth: .infinity, alignment: .leading)
            muted(trade.date, width: 100)
            muted(trade.units, width: 76)
            muted(trade.price, width: 96)
            HStack {
                Spacer(minLength: 0)
                if let fee = trade.fee {
                    Text(fee).font(.system(size: 12, weight: .semibold)).foregroundStyle(NestColor.text)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .overlay(Capsule().strokeBorder(NestColor.border, lineWidth: 1))
                        .accessibilityLabel("Brokerage \(fee)")
                } else {
                    Text("\u{2014}").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                        .accessibilityLabel("No brokerage")
                }
            }
            .frame(width: 72)
            value.frame(width: 88, alignment: .trailing)
            HStack(spacing: NestSpacing.xxs) {
                if let path = trade.documentPath {
                    IconButton(systemImage: "doc.text", label: "Document", tint: NestColor.dimmedText) {
                        onDocument(path)
                    }
                }
                EditDeleteActions(onEdit: onEdit, onDelete: onDelete)
            }
            .frame(width: 88, alignment: .trailing)
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }

    private var cardBody: some View {
        NestCard(padding: NestSpacing.xs) {
            HStack(alignment: .top, spacing: NestSpacing.sm) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        title
                        if let path = trade.documentPath {
                            Button("Document") { onDocument(path) }
                                .font(.system(size: 12)).foregroundStyle(NestColor.brand)
                                .buttonStyle(.plain)
                        }
                    }
                    Text(
                        [trade.date, trade.units, trade.price, trade.brokerage]
                            .filter { !$0.isEmpty }.joined(separator: " · ")
                    )
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
                Spacer(minLength: 0)
                HStack(spacing: NestSpacing.xxs) {
                    value
                    EditDeleteActions(onEdit: onEdit, onDelete: onDelete)
                }
            }
        }
    }
}
