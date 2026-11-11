import SwiftUI

/// The native Planning route: the held changes with a reset each, the projected
/// impact on the Summary, what-if amount edits, and Save, Discard and Exit.
struct PlanningScreen: View {
    @State private var model: PlanningViewModel
    private let planning = PlanningStore.shared

    init(model: PlanningViewModel = PlanningViewModel()) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScreenStateView(state: model.state, retry: { Task { await model.retry() } }) { content in
            PlanningContentView(model: model, content: content)
        }
        .task(id: planning.revision) { await model.load() }
    }
}

struct PlanningContentView: View {
    let model: PlanningViewModel
    let content: PlanningContent
    @State private var editing: EditableAmount?

    private var planning: PlanningStore { model.planning }
    private var pending: [PendingChange] {
        PlanningPresentation.pending(planning.state, real: content.real)
    }

    var body: some View {
        NestPageSection(
            title: "Planning",
            intro:
                "Every change planning mode is holding, and what it does to your plan. Save to make it real, or discard it."
        ) {
            if planning.isActive {
                pendingCard
                impactCard
                editCard
                actions
            } else {
                offCard
            }
        }
        .sheet(item: $editing) { item in
            PlanningEditSheet(item: item, planning: planning)
        }
    }

    private var offCard: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                Text("Planning mode is off").font(NestFont.heading).foregroundStyle(NestColor.text)
                Text(
                    "Try changes to your pays, bills and savings goals and watch the Summary update, without saving anything."
                )
                .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                Button("Turn on planning mode") { planning.enter() }
                    .buttonStyle(NestPrimaryButtonStyle())
            }
        }
    }

    private var impactCard: some View {
        let baseline = content.baseline
        let projected = content.projected
        return NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.sm) {
                Text("Projected impact").font(NestFont.heading).foregroundStyle(NestColor.text)
                impactRow(
                    "Fortnightly buffer", baseline.afterSaving.fortnightlyCents,
                    projected.afterSaving.fortnightlyCents, signed: true)
                impactRow(
                    "Available", baseline.available.fortnightlyCents,
                    projected.available.fortnightlyCents)
                impactRow(
                    "Outgoings", baseline.outgoings.fortnightlyCents,
                    projected.outgoings.fortnightlyCents)
                impactRow(
                    "Saving", baseline.savingsBlock.fortnightlyCents,
                    projected.savingsBlock.fortnightlyCents)
            }
        }
    }

    private func impactRow(_ label: String, _ was: Int64, _ now: Int64, signed: Bool = false)
        -> some View
    {
        HStack {
            Text(label).font(NestFont.small.weight(.medium)).foregroundStyle(NestColor.text)
            Spacer(minLength: NestSpacing.sm)
            ComparedAmount(baselineCents: Int(was), proposedCents: Int(now), colouring: signed)
                .font(NestFont.small.weight(.bold))
        }
        .accessibilityElement(children: .combine)
    }

    private var pendingCard: some View {
        NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                Text("Pending changes").font(NestFont.heading).foregroundStyle(NestColor.text)
                if pending.isEmpty {
                    NestEmptyState(text: "Nothing changed yet. Edit an amount below to try it.")
                }
                ForEach(pending) { change in
                    NestListRow(
                        title: change.name,
                        subtitle: [change.table.title, change.detail].compactMap { $0 }.joined(
                            separator: " · ")
                    ) {
                        HStack(spacing: NestSpacing.xs) {
                            NestPill(
                                text: change.kind.title,
                                tone: change.kind == .removed ? .negative : .brand)
                            Button {
                                planning.reset(change.table, id: change.rowID)
                            } label: {
                                Image(systemName: "arrow.uturn.backward")
                            }
                            .accessibilityLabel("Reset \(change.name)")
                        }
                    }
                }
            }
        }
    }

    private var editCard: some View {
        let rows = PlanningPresentation.editable(content.proposed)
        return NestCard {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                Text("Try a change").font(NestFont.heading).foregroundStyle(NestColor.text)
                ForEach(PlanningTable.allCases, id: \.self) { table in
                    let section = rows.filter { $0.table == table }
                    if !section.isEmpty {
                        Text(table.title + "s").font(NestFont.caption)
                            .foregroundStyle(NestColor.dimmedText).padding(.top, NestSpacing.xs)
                        ForEach(section) { item in
                            Button { editing = item } label: {
                                NestListRow(title: item.name) {
                                    MoneyText(cents: item.cents, colouring: false)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Text(
                    "Derived budget lines and everything outside pays, bills and goals keep saving normally."
                )
                .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                .padding(.top, NestSpacing.xs)
            }
        }
    }

    private var actions: some View {
        VStack(spacing: NestSpacing.sm) {
            if let error = model.saveError {
                Text(error.userMessage).font(NestFont.caption).foregroundStyle(NestColor.negative)
            }
            Button {
                Task { await model.save() }
            } label: {
                if model.isSaving { ProgressView() } else { Text("Save changes") }
            }
            .buttonStyle(NestPrimaryButtonStyle())
            .disabled(pending.isEmpty || model.isSaving)
            Button("Discard changes") { planning.discard() }
                .disabled(pending.isEmpty || model.isSaving)
            Button("Exit planning mode", role: .destructive) { planning.exit() }
                .disabled(model.isSaving)
        }
    }
}

/// Edits one row's amount in the sandbox, or removes the row from it.
private struct PlanningEditSheet: View {
    let item: EditableAmount
    let planning: PlanningStore
    @Environment(\.dismiss) private var dismiss
    @State private var text: String

    init(item: EditableAmount, planning: PlanningStore) {
        self.item = item
        self.planning = planning
        _text = State(initialValue: String(format: "%.2f", Double(item.cents) / 100))
    }

    private var cents: Int? { PlanningPresentation.parseCents(text) }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.md) {
            Text(item.name).font(NestFont.heading).foregroundStyle(NestColor.text)
            NestField(label: "Amount ($)", text: $text, prompt: "0.00")
            Button("Apply to plan") {
                if let cents {
                    planning.update(item.table, id: item.rowID, patch: [item.column: .int(cents)])
                    dismiss()
                }
            }
            .buttonStyle(NestPrimaryButtonStyle())
            .disabled(cents == nil)
            Button("Remove from plan", role: .destructive) {
                planning.delete(item.table, id: item.rowID)
                dismiss()
            }
            Button("Cancel") { dismiss() }
            Spacer()
        }
        .padding(NestSpacing.lg)
        .background(NestColor.background)
        .presentationDetents([.medium])
    }
}
