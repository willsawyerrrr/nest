import SwiftUI

/// The native Goals route: savings goals with progress and projection, the
/// drag-reorderable Upcoming queue, and add, edit and delete.
struct GoalsScreen: View {
    @State private var model: GoalsViewModel
    private let planning = PlanningStore.shared

    init(model: GoalsViewModel = GoalsViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            GoalsContentView(model: model, content: content)
        }
        .task(id: planning.revision) { await model.load() }
    }
}

/// What the inline form is doing.
private enum GoalEditing: Equatable {
    case none
    case adding
    case editing(String)
}

struct GoalsContentView: View {
    let model: GoalsViewModel
    let content: GoalsContent

    @State private var editing = GoalEditing.none
    @State private var deleting: GoalRow?
    @State private var width: CGFloat = 0

    private var presentation: GoalsPresentation { GoalsPresentation(content: content) }
    private var savers: [GoalSaver] { content.rows.saverList }
    private var isWide: Bool { width >= 768 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NestSpacing.md) {
                PlanningBanner()
                refreshRow
                if let error = model.syncError { GoalAlert(text: error) }
                activeList
                if !presentation.queued.isEmpty { upcoming }
            }
            .padding(NestSpacing.md)
            .background(
                GeometryReader { Color.clear.preference(key: GoalsWidthKey.self, value: $0.size.width) })
        }
        .onPreferenceChange(GoalsWidthKey.self) { width = $0 }
        .refreshable { await model.syncFromUp() }
        .alert(
            "Delete goal?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { goal in
            Button("Delete", role: .destructive) {
                Task { try? await model.remove(id: goal.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { goal in
            Text("Delete \(goal.name)? This cannot be undone.")
        }
    }

    private var refreshRow: some View {
        HStack {
            Spacer()
            Button {
                Task { await model.syncFromUp() }
            } label: {
                HStack(spacing: 6) {
                    if model.isSyncing {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
                    }
                    Text("Refresh").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(NestColor.brand)
                .padding(.horizontal, NestSpacing.sm)
                .frame(height: 30)
                .background(
                    NestColor.brand.opacity(0.16),
                    in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(model.isSyncing)
        }
    }

    private var activeList: some View {
        VStack(alignment: .leading, spacing: NestSpacing.md) {
            if presentation.active.isEmpty && editing != .adding {
                Text(GoalsPresentation.emptyMessage)
                    .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            }
            ForEach(presentation.active) { goal in
                item(goal, reorderable: false)
            }
            if editing == .adding {
                form(editing: nil)
            } else {
                GoalAddButton(label: "Add goal") { editing = .adding }
            }
        }
    }

    private var upcoming: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            Text("Upcoming")
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(NestColor.text)
            Text(GoalsPresentation.upcomingNote)
                .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            ForEach(presentation.queued) { goal in
                item(goal, reorderable: true)
            }
        }
    }

    @ViewBuilder
    private func item(_ goal: GoalRow, reorderable: Bool) -> some View {
        if editing == .editing(goal.id),
            let stored = content.rows.savingsGoals.first(where: { $0.id == goal.id })
        {
            form(editing: stored)
        } else if reorderable {
            queuedItem(goal)
        } else {
            display(goal, handle: nil)
        }
    }

    private func form(editing stored: SavingsGoal?) -> some View {
        GoalForm(
            editing: stored, savers: savers,
            onSubmit: { input in
                if let stored {
                    try await model.update(id: stored.id, input: input)
                } else {
                    try await model.create(input)
                }
                editing = .none
            },
            onCancel: { editing = .none })
    }

    private func display(_ goal: GoalRow, handle: AnyView?) -> some View {
        Group {
            if isWide {
                GoalListRow(
                    goal: goal, handle: handle, onEdit: { editing = .editing(goal.id) },
                    onDelete: { deleting = goal })
            } else {
                GoalCard(
                    goal: goal, handle: handle, onEdit: { editing = .editing(goal.id) },
                    onDelete: { deleting = goal })
            }
        }
    }

    private func queuedItem(_ goal: GoalRow) -> some View {
        let ids = presentation.queued.map(\.id)
        let index = ids.firstIndex(of: goal.id) ?? 0
        let handle = AnyView(
            Image(systemName: "circle.grid.2x3")
                .font(.system(size: 12))
                .foregroundStyle(NestColor.dimmedText)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
                .draggable(goal.id) {
                    display(goal, handle: nil).frame(width: max(width - 2 * NestSpacing.md, 240))
                }
                .accessibilityLabel("Reorder \(goal.name)"))
        return display(goal, handle: handle)
            .dropDestination(for: String.self) { dropped, _ in
                guard let dragged = dropped.first,
                    let order = GoalsPresentation.nextQueueOrder(ids, dragged: dragged, over: goal.id)
                else { return false }
                Task { try? await model.reorder(order) }
                return true
            }
            .accessibilityAction(named: "Move up") {
                guard index > 0, let order = GoalsPresentation.nextQueueOrder(ids, dragged: goal.id, over: ids[index - 1])
                else { return }
                Task { try? await model.reorder(order) }
            }
            .accessibilityAction(named: "Move down") {
                guard index < ids.count - 1,
                    let order = GoalsPresentation.nextQueueOrder(ids, dragged: goal.id, over: ids[index + 1])
                else { return }
                Task { try? await model.reorder(order) }
            }
    }
}

/// One goal as a compact bordered card, for narrow widths.
struct GoalCard: View {
    let goal: GoalRow
    let handle: AnyView?
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                HStack(alignment: .center, spacing: NestSpacing.sm) {
                    Text(goal.name)
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    HStack(spacing: 4) {
                        GoalBadge(text: goal.status.label, tone: goal.status.tone)
                        if let handle { handle }
                        GoalEditDeleteActions(onEdit: onEdit, onDelete: onDelete)
                    }
                }
                HStack(alignment: .firstTextBaseline) {
                    Text("\(MoneyFormat.cents(goal.balanceCents)) of \(MoneyFormat.cents(goal.targetCents))")
                        .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText).monospacedDigit()
                    Spacer()
                    Text("\(goal.roundedPercent)%")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(NestColor.text)
                }
                GoalProgressBar(percent: goal.percent, tone: goal.status.tone, name: goal.name)
                GoalSegmentsText(segments: goal.eta)
                if let saver = goal.saverName {
                    HStack(spacing: NestSpacing.xs) {
                        Text("From synced saver \(saver)")
                            .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                        if goal.saverDeleted { GoalBadge(text: "Deleted at source", tone: .warning) }
                    }
                }
                if goal.saverDeleted {
                    Text("This saver was deleted at its source. Relink the goal to a current saver.")
                        .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
                if goal.contributionCents > 0 {
                    Text("Linked contribution \(MoneyFormat.perFortnight(goal.contributionCents))")
                        .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One goal as a dense table-like row, for wide layouts.
struct GoalListRow: View {
    let goal: GoalRow
    let handle: AnyView?
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: NestSpacing.md) {
                HStack(spacing: NestSpacing.xs) {
                    Text(goal.name)
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
                        .lineLimit(1)
                    GoalBadge(text: goal.status.label, tone: goal.status.tone)
                    if goal.saverDeleted { GoalBadge(text: "Deleted at source", tone: .warning) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text("\(goal.roundedPercent)%")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(NestColor.text)
                    .frame(width: 48, alignment: .trailing)
                GoalProgressBar(percent: goal.percent, tone: goal.status.tone, name: goal.name)
                    .frame(width: 96)
                Text(MoneyFormat.cents(goal.targetCents))
                    .font(.system(size: 14)).monospacedDigit().foregroundStyle(NestColor.text)
                    .frame(width: 96, alignment: .trailing)
                Group {
                    if goal.contributionCents > 0 {
                        GoalFortnightlyAmount(segments: goal.contribution)
                    } else {
                        Color.clear
                    }
                }
                .frame(width: 112, alignment: .trailing)
                HStack(spacing: 4) {
                    if let handle { handle }
                    GoalEditDeleteActions(onEdit: onEdit, onDelete: onDelete)
                }
            }
            HStack(spacing: 0) {
                GoalSegmentsText(segments: goal.eta, color: NestColor.dimmedText)
                if let saver = goal.saverName {
                    Text(
                        " · From synced saver \(saver)\(goal.saverDeleted ? " \u{2014} deleted at source, relink this goal" : "")"
                    )
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NestColor.border).frame(height: 1) }
    }
}
