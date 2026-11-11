import SwiftUI

/// The native Inflows route: the household's inflows with add, edit and delete,
/// laid out like the PWA's `InflowList` (a dense row when wide, a card when compact).
struct InflowsScreen: View {
    @State private var model: InflowsViewModel
    private let planning = PlanningStore.shared

    init(model: InflowsViewModel = InflowsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            InflowsListView(model: model, content: content)
        }
        .task(id: planning.revision) { await model.load() }
    }
}

struct InflowsListView: View {
    let model: InflowsViewModel
    let content: InflowsContent

    @State private var editingID: String?
    @State private var adding = false
    @State private var deleting: InflowListRow?
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var isWide: Bool {
        #if os(macOS)
            true
        #else
            sizeClass == .regular
        #endif
    }

    private var presentation: InflowsPresentation {
        InflowsPresentation(
            rows: content.rows, fortnightlies: content.fortnightlies, now: model.instant)
    }

    var body: some View {
        let list = presentation.list
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                PlanningBanner()
                if list.isEmpty && !adding {
                    Text("No inflows yet. Add one to get started.")
                        .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                }
                ForEach(list) { row in
                    if editingID == row.id, let inflow = presentation.inflow(id: row.id) {
                        form(initial: inflow) { input in
                            try await model.update(id: row.id, input)
                            editingID = nil
                        }
                    } else if isWide {
                        InflowDenseRow(
                            row: row, onEdit: { start(editing: row.id) }, onDelete: { deleting = row })
                    } else {
                        InflowCardRow(
                            row: row, onEdit: { start(editing: row.id) }, onDelete: { deleting = row })
                    }
                }
                if adding {
                    form(initial: nil) { input in
                        try await model.create(input)
                        adding = false
                    }
                } else {
                    InflowAddButton(label: "Add inflow") {
                        editingID = nil
                        adding = true
                    }
                    .accessibilityIdentifier("add-inflow")
                }
            }
            .padding(NestSpacing.md)
        }
        .alert(
            "Delete inflow?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { row in
            Button("Delete", role: .destructive) {
                Task { try? await model.delete(id: row.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text("Delete \(row.name)? This cannot be undone.")
        }
    }

    private func start(editing id: String) {
        adding = false
        editingID = id
    }

    private func form(
        initial: Inflow?, onSubmit: @escaping (InflowInput) async throws -> Void
    ) -> some View {
        InflowFormView(
            members: content.rows.members, initial: initial,
            preview: { await model.preview($0, members: content.rows.members) },
            onSubmit: onSubmit,
            onCancel: {
                editingID = nil
                adding = false
            })
    }
}

/// The pencil and red trash controls beside each inflow.
private struct InflowActions: View {
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onEdit) {
                Image(systemName: "pencil").font(.system(size: 15))
                    .foregroundStyle(NestColor.dimmedText).frame(width: 28, height: 28)
            }
            .accessibilityLabel("Edit")
            Button(action: onDelete) {
                Image(systemName: "trash").font(.system(size: 15))
                    .foregroundStyle(NestColor.negative).frame(width: 28, height: 28)
            }
            .accessibilityLabel("Delete")
        }
        .buttonStyle(.plain)
    }
}

/// The fortnightly figure with a dimmed `/ fn`, or a note that a one-off has none.
private struct InflowFortnightlyView: View {
    let cents: Int64?
    var alignment: HorizontalAlignment = .trailing

    var body: some View {
        if let cents {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                MoneyText(cents: Int(cents), colouring: false)
                    .font(.system(size: 14, weight: .bold))
                Text("/ fn").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
        } else {
            Text("Not fortnightly").font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
        }
    }
}

private struct InflowInactiveBadge: View {
    var body: some View { InflowBadge(text: "Inactive", style: .light(NestColor.dimmedText)) }
}

/// One inflow as a bordered card, for compact widths.
private struct InflowCardRow: View {
    let row: InflowListRow
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.name).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    if row.isEnded { InflowInactiveBadge() }
                }
                FlowRow(spacing: 6) {
                    if let member = row.memberName {
                        Text(member).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    }
                    Text(row.amount).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    if !row.isTaxable {
                        InflowBadge(text: "Non-taxable", style: .light(NestColor.dimmedText))
                    }
                    InflowBadge(text: row.typeLabel, style: .light(ChartColorKey.wants.color))
                    InflowBadge(text: row.cadence)
                }
                if !row.isEnded, let caption = row.caption {
                    Text(caption).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
            Spacer(minLength: 0)
            InflowFortnightlyView(cents: row.fortnightlyCents)
            InflowActions(onEdit: onEdit, onDelete: onDelete)
        }
        .padding(NestSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            NestColor.surface,
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .opacity(row.isEnded ? 0.55 : 1)
        .accessibilityIdentifier("inflow-row")
    }
}

/// One inflow as a dense table-like row over a light rule, for wide layouts.
private struct InflowDenseRow: View {
    let row: InflowListRow
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: row.caption == nil || row.isEnded ? 0 : 4) {
            HStack(spacing: NestSpacing.sm) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(row.name).font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(NestColor.text).lineLimit(1)
                    if row.isEnded { InflowInactiveBadge() }
                    Spacer(minLength: 0)
                    Text(row.subtitle).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                        .lineLimit(1).frame(maxWidth: 192, alignment: .trailing)
                }
                .frame(maxWidth: .infinity)
                Text(row.amount).font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
                    .lineLimit(1).frame(width: 112, alignment: .trailing)
                InflowBadge(text: row.cadence).frame(width: 128, alignment: .trailing)
                InflowFortnightlyView(cents: row.fortnightlyCents)
                    .frame(width: 112, alignment: .trailing)
                InflowActions(onEdit: onEdit, onDelete: onDelete)
            }
            if !row.isEnded, let caption = row.caption {
                Text(caption).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
        .opacity(row.isEnded ? 0.55 : 1)
        .accessibilityIdentifier("inflow-row")
    }
}

/// A wrapping row of small items, as Mantine's `Group wrap="wrap"`.
private struct FlowRow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified
            )
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}
