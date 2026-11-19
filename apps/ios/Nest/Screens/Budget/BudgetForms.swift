import SwiftUI

/// The bordered card, error line and submit/cancel footer the PWA's `FormShell` draws.
private struct BudgetFormShell<Fields: View>: View {
    let submitLabel: String
    let canSubmit: Bool
    let submitting: Bool
    let error: String?
    let onSubmit: () -> Void
    let onCancel: () -> Void
    @ViewBuilder var fields: Fields

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            fields
            if let error {
                Text(error).font(.system(size: 14)).foregroundStyle(NestColor.negative)
                    .accessibilityIdentifier("budget-form-error")
            }
            HStack(spacing: NestSpacing.xs) {
                Button(submitting ? "Saving…" : submitLabel, action: onSubmit)
                    .buttonStyle(NestPrimaryButtonStyle())
                    .disabled(!canSubmit || submitting)
                    .opacity(canSubmit && !submitting ? 1 : 0.5)
                    .accessibilityIdentifier("budget-form-submit")
                Button("Cancel", action: onCancel).buttonStyle(InflowSecondaryButtonStyle())
            }
        }
        .padding(NestSpacing.sm)
        .background(
            NestColor.surface, in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1))
    }
}

/// A field's red error line, as a Mantine input's `error`.
private struct FieldError: View {
    let message: String?

    var body: some View {
        if let message {
            Text(message).font(.system(size: 12)).foregroundStyle(NestColor.negative)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// A read-only labelled value, as the PWA's label-over-text stacks.
private struct ReadOnlyField: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            Text(value).font(.system(size: 14)).foregroundStyle(NestColor.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private enum BudgetFormOptions {
    static let groups: [(BudgetGroup, String)] = BudgetGroup.allCases.map { ($0, $0.title) }
    static let frequencies: [(Frequency, String)] = InflowFormState.frequencies.map {
        ($0, $0.label(interval: nil))
    }

    /// `options` behind a leading `nil` choice reading `placeholder`, as a clearable select.
    static func clearable(_ options: [(id: String, name: String)], placeholder: String)
        -> [(String?, String)]
    {
        [(nil, placeholder)] + options.map { (Optional($0.id), $0.name) }
    }

    /// `Weeks` or `Months`, and their lower-case unit.
    static func intervalUnit(_ frequency: Frequency) -> (title: String, unit: String) {
        frequency == .everyNMonths ? ("Months", "months") : ("Weeks", "weeks")
    }
}

/// Saves `submit` with the form's in-flight and error state.
@MainActor
private func save(
    submitting: Binding<Bool>, error: Binding<String?>, message: @escaping (Error) -> String,
    _ submit: @escaping () async throws -> Void
) {
    guard !submitting.wrappedValue else { return }
    submitting.wrappedValue = true
    error.wrappedValue = nil
    Task {
        do {
            try await submit()
        } catch let thrown {
            error.wrappedValue = message(thrown)
        }
        submitting.wrappedValue = false
    }
}

/// The manual budget line add/edit form, mirroring the PWA's `BudgetLineForm`
/// field for field: group, name, frequency (with its interval), amount, then the
/// goal, allowance or funding account the group offers, and the management link.
struct BudgetLineFormView: View {
    let goals: [(id: String, name: String)]
    let accounts: [(id: String, name: String)]
    let onSubmit: (BudgetLineInput) async throws -> Void
    let onCancel: () -> Void

    @State private var form: BudgetLineFormState
    @State private var submitting = false
    @State private var error: String?

    init(
        form: BudgetLineFormState, goals: [(id: String, name: String)],
        accounts: [(id: String, name: String)],
        onSubmit: @escaping (BudgetLineInput) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        _form = State(initialValue: form)
        self.goals = goals
        self.accounts = accounts
        self.onSubmit = onSubmit
        self.onCancel = onCancel
    }

    var body: some View {
        BudgetFormShell(
            submitLabel: form.initial == nil ? "Add item" : "Save changes",
            canSubmit: form.canSubmit, submitting: submitting, error: error,
            onSubmit: submit, onCancel: onCancel
        ) {
            InflowField(label: "Group") {
                InflowSelect(
                    options: BudgetFormOptions.groups,
                    selection: Binding(get: { form.group }, set: { form.setGroup($0) }))
            }
            InflowField(label: "Name") {
                InflowTextInput(text: $form.name, identifier: "budget-line-name")
            }
            InflowField(
                label: "Frequency",
                description: "The app converts every amount to fortnightly and annual."
            ) {
                InflowSelect(options: BudgetFormOptions.frequencies, selection: $form.frequency)
            }
            if form.frequency.isEveryN {
                let unit = BudgetFormOptions.intervalUnit(form.frequency)
                InflowField(
                    label: "\(unit.title) between allocations",
                    description:
                        "How many \(unit.unit) apart each allocation lands (e.g. 4 for once every four \(unit.unit))."
                ) { InflowTextInput(text: $form.interval, numeric: true) }
            }
            InflowField(label: "Amount") {
                InflowTextInput(
                    text: $form.amount, prefix: "$", numeric: true, identifier: "budget-line-amount")
                FieldError(message: form.overdraws ? AllowanceCopy.itemOverdraws : nil)
            }
            if form.showsGoalPicker {
                InflowField(
                    label: "Goal", description: "Optional. Links this line's contribution to a savings goal."
                ) {
                    InflowSelect(
                        options: BudgetFormOptions.clearable(goals, placeholder: "No goal"),
                        selection: $form.goalId)
                }
                Text("This line's pay split is routed to its goal's linked synced saver.")
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
            if form.showsAllowancePicker {
                InflowField(
                    label: "Draw from allowance",
                    description:
                        "Optional. Counts this item against someone's allowance instead of adding to the budget on top of it."
                ) {
                    InflowSelect(
                        options: BudgetFormOptions.clearable(
                            form.allowances.map { ($0.memberId, $0.name) },
                            placeholder: "Not drawn from an allowance"),
                        selection: $form.allowanceMemberId)
                }
                if let drawnFrom = form.drawnFrom {
                    Text("Paid from \(drawnFrom.name), so it is funded with the allowance.")
                        .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
                }
            }
            if form.showsAccountPicker {
                InflowField(
                    label: "Funded from",
                    description: "Optional. The account or synced saver whose pay split funds this line."
                ) {
                    InflowSelect(
                        options: BudgetFormOptions.clearable(accounts, placeholder: "Not routed"),
                        selection: $form.destinationAccountId)
                }
            }
            InflowField(
                label: "Management link",
                description: "Optional. Where to manage or cancel this subscription."
            ) {
                ManagementLinkInput(text: $form.managementUrl)
                FieldError(message: form.isManagementUrlValid ? nil : ManagementURL.invalidMessage)
            }
        }
        .accessibilityIdentifier("budget-line-form")
    }

    private func submit() {
        guard let input = form.input else { return }
        save(submitting: $submitting, error: $error, message: BudgetLineFormState.failureMessage) {
            try await onSubmit(input)
        }
    }
}

/// The management link's URL input, with the PWA's `netflix.com/account` placeholder.
private struct ManagementLinkInput: View {
    @Binding var text: String

    var body: some View {
        TextField("netflix.com/account", text: $text)
            #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            #else
                .textFieldStyle(.plain)
            #endif
            .accessibilityIdentifier("budget-line-management-url")
            .inflowInputBox()
    }
}

/// The allowance edit form, mirroring the PWA's `MemberAllowanceForm`.
struct MemberAllowanceFormView: View {
    let memberName: String
    let accounts: [(id: String, name: String)]
    let onSubmit: (MemberAllowanceInput) async throws -> Void
    let onCancel: () -> Void

    @State private var form: MemberAllowanceFormState
    @State private var submitting = false
    @State private var error: String?

    init(
        memberName: String, form: MemberAllowanceFormState,
        accounts: [(id: String, name: String)],
        onSubmit: @escaping (MemberAllowanceInput) async throws -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.memberName = memberName
        _form = State(initialValue: form)
        self.accounts = accounts
        self.onSubmit = onSubmit
        self.onCancel = onCancel
    }

    var body: some View {
        BudgetFormShell(
            submitLabel: "Save changes", canSubmit: form.canSubmit, submitting: submitting,
            error: error, onSubmit: submit, onCancel: onCancel
        ) {
            InflowField(
                label: BudgetPresentation.allowanceName(memberName),
                description: "What they can spend on themselves. Items drawn from it count against it."
            ) {
                InflowTextInput(
                    text: $form.amount, prefix: "$", numeric: true, identifier: "allowance-amount")
                FieldError(message: form.belowDrawn ? AllowanceCopy.belowDrawn : nil)
            }
            InflowField(label: "Frequency") {
                InflowSelect(options: BudgetFormOptions.frequencies, selection: $form.frequency)
            }
            if form.frequency.isEveryN {
                let unit = BudgetFormOptions.intervalUnit(form.frequency)
                InflowField(
                    label: "\(unit.title) between allowances",
                    description:
                        "How many \(unit.unit) apart each allowance lands (e.g. 4 for once every four \(unit.unit))."
                ) { InflowTextInput(text: $form.interval, numeric: true) }
            }
            InflowField(
                label: "Funded from",
                description:
                    "Optional. The account or synced saver whose pay split funds the allowance and what is drawn from it."
            ) {
                InflowSelect(
                    options: BudgetFormOptions.clearable(accounts, placeholder: "Not routed"),
                    selection: $form.accountId)
            }
        }
        .accessibilityIdentifier("allowance-form")
    }

    private func submit() {
        guard let input = form.input else { return }
        save(submitting: $submitting, error: $error, message: MemberAllowanceFormState.failureMessage) {
            try await onSubmit(input)
        }
    }
}

/// The derived line's editor, mirroring the PWA's `DerivedBudgetLineForm`: group,
/// name (read-only for a gift line), funding account (a note for a gift member
/// line), and the locked rolled-up amount with a link to where it is edited.
struct DerivedLineFormView: View {
    let line: BudgetLineRow
    let accounts: [(id: String, name: String)]
    let onSubmit: (DerivedLineValues) async throws -> Void
    let onCancel: () -> Void

    @State private var form: DerivedLineFormState
    @State private var submitting = false
    @State private var error: String?

    init(
        line: BudgetLineRow, form: DerivedLineFormState, accounts: [(id: String, name: String)],
        onSubmit: @escaping (DerivedLineValues) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.line = line
        _form = State(initialValue: form)
        self.accounts = accounts
        self.onSubmit = onSubmit
        self.onCancel = onCancel
    }

    private var isGift: Bool { line.source == .gifts }

    var body: some View {
        BudgetFormShell(
            submitLabel: "Save changes", canSubmit: form.canSubmit, submitting: submitting,
            error: error, onSubmit: submit, onCancel: onCancel
        ) {
            InflowField(label: "Group") {
                InflowSelect(
                    options: DerivedLineFormState.groups.map { ($0, $0.title) },
                    selection: $form.group)
            }
            if form.nameEditable {
                InflowField(label: "Name") { InflowTextInput(text: $form.name) }
            } else {
                ReadOnlyField(label: "Name", value: form.name)
            }
            if form.fundingLocked {
                ReadOnlyField(
                    label: "Funded from", value: "Automatically from the buyer's spending account.")
            } else {
                InflowField(
                    label: "Funded from",
                    description: "Optional. The account or synced saver whose pay split funds this line."
                ) {
                    InflowSelect(
                        options: BudgetFormOptions.clearable(accounts, placeholder: "Not routed"),
                        selection: $form.destinationAccountId)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Amount").font(.system(size: 14, weight: .medium))
                    .foregroundStyle(NestColor.text)
                HStack {
                    Text(MoneyFormat.perFortnight(Int(line.fortnightlyCents)))
                        .font(.system(size: 14, weight: .bold)).monospacedDigit()
                        .foregroundStyle(NestColor.text)
                    Spacer()
                    if let source = line.source {
                        NavigationLink(value: source.route) {
                            Text(isGift ? "Edit in gifts" : "Edit in breakdown")
                                .font(.system(size: 14)).foregroundStyle(NestColor.brand)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text(
                    isGift
                        ? "The amount is rolled up from the gift budgets."
                        : "The amount is rolled up from the breakdown's items."
                )
                .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
        }
        .accessibilityIdentifier("derived-line-form")
    }

    private func submit() {
        guard form.canSubmit else { return }
        let values = form.values
        save(
            submitting: $submitting, error: $error,
            message: { _ in "Could not save this budget item. Please try again." }
        ) { try await onSubmit(values) }
    }
}
