import SwiftUI

/// A labelled Mantine `sm` field: 14pt medium label, optional dimmed description
/// and a 36pt bordered control.
private struct GoalField<Control: View>: View {
    let label: String
    var description: String?
    @ViewBuilder var control: Control

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            if let description {
                Text(description).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            control
                .font(.system(size: 14))
                .foregroundStyle(NestColor.text)
                .padding(.horizontal, NestSpacing.sm)
                .frame(minHeight: 36, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    NestColor.surface,
                    in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                        .strokeBorder(NestColor.border, lineWidth: 1))
        }
    }
}

/// The add and edit form for one savings goal, in the PWA's bordered form card.
struct GoalForm: View {
    let editing: SavingsGoal?
    let savers: [GoalSaver]
    let onSubmit: (GoalInput) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: GoalDraft
    @State private var submitting = false
    @State private var error: String?

    init(
        editing: SavingsGoal?, savers: [GoalSaver],
        onSubmit: @escaping (GoalInput) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.editing = editing
        self.savers = savers
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(initialValue: editing.map(GoalDraft.init(goal:)) ?? GoalDraft())
    }

    private var submitLabel: String {
        submitting ? "Saving…" : editing == nil ? "Add goal" : "Save changes"
    }

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                GoalField(label: "Name") {
                    TextField("", text: $draft.name).textFieldStyle(.plain)
                }
                GoalField(label: "Target amount") { moneyField($draft.targetAmount) }
                GoalField(
                    label: "Target date",
                    description: "Optional. Sets the contribution needed to reach the target."
                ) { dateControl }
                GoalField(
                    label: "Modelled interest rate (% p.a.)",
                    description:
                        "Optional. Compounds fortnightly in the projected ETA and required contribution."
                ) {
                    HStack(spacing: 2) {
                        TextField("", text: $draft.interestRate).textFieldStyle(.plain)
                            #if os(iOS)
                                .keyboardType(.decimalPad)
                            #endif
                        Text("%").foregroundStyle(NestColor.dimmedText)
                    }
                }
                GoalField(
                    label: "Planned fortnightly contribution",
                    description:
                        "Optional. What this goal draws from freed-up saving once the goals above it finish. Blank draws the whole available amount."
                ) { moneyField($draft.plannedContribution) }
                saverControl
                if draft.linkedSaverDeleted(in: savers) {
                    GoalAlert(
                        text:
                            "This saver was deleted at its source. Link the goal to a current saver, or clear the link and track the balance manually.",
                        tone: .warning, compact: true)
                }
                if draft.linkedAccountID == nil {
                    GoalField(label: "Current balance", description: "Entered manually for now.") {
                        moneyField($draft.currentBalance)
                    }
                }
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(NestColor.negative)
                        .accessibilityAddTraits(.isStaticText)
                }
                HStack(spacing: NestSpacing.xs) {
                    Button(submitLabel) { Task { await submit() } }
                        .buttonStyle(GoalPrimaryButtonStyle())
                        .disabled(!draft.canSubmit || submitting)
                    Button("Cancel", action: onCancel)
                        .buttonStyle(GoalPrimaryButtonStyle(primary: false))
                }
            }
        }
    }

    private func moneyField(_ text: Binding<String>) -> some View {
        HStack(spacing: 2) {
            Text("$").foregroundStyle(NestColor.dimmedText)
            TextField("", text: text).textFieldStyle(.plain)
                #if os(iOS)
                    .keyboardType(.decimalPad)
                #endif
        }
    }

    private var dateControl: some View {
        HStack {
            if let iso = draft.targetDate {
                DatePicker(
                    "Target date", selection: dateBinding(iso), displayedComponents: .date
                )
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "en_AU"))
                Spacer()
                Button {
                    draft.targetDate = nil
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(NestColor.dimmedText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear target date")
            } else {
                Button("Set a date") { draft.targetDate = Self.iso(Date()) }
                    .buttonStyle(.plain).foregroundStyle(NestColor.dimmedText)
                Spacer()
            }
        }
    }

    private var saverControl: some View {
        Group {
            if savers.isEmpty {
                Text("Connect a bank and sync to link a saver.")
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            } else {
                GoalField(
                    label: "Synced saver",
                    description: "Optional. Pulls the current balance from a synced saver."
                ) {
                    Menu {
                        Button("Not linked") { draft.link(nil) }
                        ForEach(savers) { saver in
                            Button(
                                saver.isDeletedAtSource
                                    ? "\(saver.name) (deleted at source)" : saver.name
                            ) { draft.link(saver) }
                        }
                    } label: {
                        HStack {
                            Text(selectedSaverName ?? "Not linked")
                                .foregroundStyle(
                                    selectedSaverName == nil ? NestColor.dimmedText : NestColor.text)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 10))
                                .foregroundStyle(NestColor.dimmedText)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var selectedSaverName: String? {
        savers.first { $0.id == draft.linkedAccountID }.map {
            $0.isDeletedAtSource ? "\($0.name) (deleted at source)" : $0.name
        }
    }

    private func submit() async {
        guard draft.canSubmit else { return }
        submitting = true
        error = nil
        do {
            try await onSubmit(draft.input(queuePosition: editing?.queuePosition))
        } catch {
            self.error = GoalDraft.saveFailure
        }
        submitting = false
    }

    private func dateBinding(_ iso: String) -> Binding<Date> {
        Binding(
            get: { Self.date(iso) ?? Date() },
            set: { draft.targetDate = Self.iso($0) })
    }

    private static func date(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar(identifier: .gregorian).date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func iso(_ date: Date) -> String {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 1, parts.day ?? 1)
    }
}
