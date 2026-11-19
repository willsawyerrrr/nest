import SwiftUI

/// Runs a form's save: shows `submitting` while it runs and, on failure, the copy
/// `EquityPresentation.failure` gives for the error.
@MainActor
private func submit(
    _ save: () async throws -> Void, submitting: Binding<Bool>, error message: Binding<String?>,
    fallback: String
) async {
    guard !submitting.wrappedValue else { return }
    submitting.wrappedValue = true
    message.wrappedValue = nil
    do { try await save() } catch {
        message.wrappedValue = EquityPresentation.failure(error, fallback: fallback)
    }
    submitting.wrappedValue = false
}

/// A whole-number field: digits only, as Mantine's `NumberInput` with
/// `allowDecimal={false}`.
private struct WholeNumberInput: View {
    let label: String
    var description: String?
    @Binding var text: String

    var body: some View {
        TextInput(label: label, description: description, decimal: true, text: $text)
            .onChange(of: text) { _, value in
                let digits = value.filter(\.isNumber)
                if digits != value { text = digits }
            }
    }
}

/// The add and edit form for one grant, as the PWA's `EquityGrantForm`.
struct EquityGrantFormView: View {
    let memberID: String
    let editing: EquityGrant?
    let onSubmit: (EquityGrantInput) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: GrantDraft
    @State private var submitting = false
    @State private var error: String?

    init(
        memberID: String, editing: EquityGrant?,
        onSubmit: @escaping (EquityGrantInput) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.memberID = memberID
        self.editing = editing
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(
            initialValue: editing.map(GrantDraft.init(grant:))
                ?? GrantDraft(today: PayslipDraft.todayIso()))
    }

    var body: some View {
        FormCard {
            TextInput(label: "Label", placeholder: "e.g. 2024 option grant", text: $draft.label)
            SegmentedInput(
                options: EquityPresentation.instrumentTypes.map { ($0.0, $0.1) },
                selection: $draft.instrumentType
            )
            .accessibilityLabel("Instrument type")
            WholeNumberInput(
                label: "Quantity", description: "Whole options or shares granted.",
                text: $draft.quantity)
            IsoDateField(label: "Grant date", clearable: false, iso: $draft.grantDate)
            HStack(alignment: .top, spacing: FormMetric.xs) {
                WholeNumberInput(label: "Cliff (months)", text: $draft.cliffMonths)
                WholeNumberInput(
                    label: "Vesting period (months)", text: $draft.vestingPeriodMonths)
            }
            SelectInput(
                label: "Vesting frequency",
                options: EquityPresentation.vestingFrequencies.map { ($0.0, $0.1) },
                selection: $draft.vestingFrequency)
            if draft.isOption {
                TextInput(
                    label: "Strike price", description: "Per-share exercise price.", prefix: "$",
                    decimal: true, text: $draft.strikePrice)
            }
            TextInput(
                label: "Price per share",
                description: "Current fair value per share (409A-equivalent), maintained by you.",
                prefix: "$", decimal: true, text: $draft.pricePerShare)
            IsoDateField(
                label: "Price as of", description: "When the price per share was last confirmed.",
                iso: $draft.priceAsOf)
            if let error { FormError(message: error) }
            FormFooter(
                submitLabel: editing == nil ? "Add grant" : "Save changes",
                canSubmit: draft.canSubmit, submitting: submitting,
                onSubmit: {
                    Task {
                        guard let input = draft.input(memberID: memberID) else { return }
                        await submit(
                            { try await onSubmit(input) }, submitting: $submitting, error: $error,
                            fallback: EquityPresentation.grantSaveError)
                    }
                }, onCancel: onCancel)
        }
    }
}

/// The add and edit form for one exercise of options, as the PWA's `EquityExerciseForm`.
struct EquityExerciseFormView: View {
    let memberID: String
    /// The member's option grants an exercise can be recorded against.
    let grants: [EquityGrant]
    let rows: EquityRows
    let editing: EquityExercise?
    let onSubmit: (EquityExerciseInput) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: ExerciseDraft
    @State private var submitting = false
    @State private var error: String?

    init(
        memberID: String, grants: [EquityGrant], rows: EquityRows, editing: EquityExercise?,
        onSubmit: @escaping (EquityExerciseInput) async throws -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.memberID = memberID
        self.grants = grants
        self.rows = rows
        self.editing = editing
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(
            initialValue: editing.map(ExerciseDraft.init(exercise:))
                ?? ExerciseDraft(grants: grants, today: PayslipDraft.todayIso()))
    }

    private var grant: EquityGrant? { grants.first { $0.id == draft.grantID } }

    private var limitError: String? {
        guard let grant, draft.units > 0 else { return nil }
        return EquityLimits.exerciseError(
            grant, exercises: rows.exercises, sales: rows.sales, quantity: draft.units,
            ignoring: editing?.id)
    }

    private var grantSelection: Binding<String> {
        Binding(
            get: { draft.grantID ?? "" },
            set: { id in
                if let picked = grants.first(where: { $0.id == id }) {
                    draft.pick(picked, adding: editing == nil)
                }
            })
    }

    var body: some View {
        FormCard {
            SelectInput(
                label: "Grant", options: grants.map { ($0.id, $0.label) },
                selection: grantSelection)
            IsoDateField(label: "Exercise date", clearable: false, iso: $draft.exercisedOn)
            WholeNumberInput(label: "Options exercised", text: $draft.quantity)
            TextInput(
                label: "Strike paid", description: "Per-share exercise price paid.", prefix: "$",
                decimal: true, text: $draft.strike)
            TextInput(
                label: "Market price per share",
                description: "Optional. Value per share on the exercise date, for your records.",
                prefix: "$", decimal: true, text: $draft.marketPrice)
            if let message = error ?? limitError { FormError(message: message) }
            FormFooter(
                submitLabel: editing == nil ? "Add exercise" : "Save changes",
                canSubmit: grant != nil
                    && draft.input(memberID: memberID, limitError: limitError) != nil,
                submitting: submitting,
                onSubmit: {
                    Task {
                        guard grant != nil,
                            let input = draft.input(memberID: memberID, limitError: limitError)
                        else { return }
                        await submit(
                            { try await onSubmit(input) }, submitting: $submitting, error: $error,
                            fallback: EquityPresentation.exerciseSaveError)
                    }
                }, onCancel: onCancel)
        }
    }
}

/// The add and edit form for one sale of shares, as the PWA's `EquitySaleForm`.
struct EquitySaleFormView: View {
    let memberID: String
    /// The member's grants a sale can be recorded against.
    let grants: [EquityGrant]
    let rows: EquityRows
    let editing: EquitySale?
    let onSubmit: (EquitySaleInput) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: SaleDraft
    @State private var submitting = false
    @State private var error: String?

    init(
        memberID: String, grants: [EquityGrant], rows: EquityRows, editing: EquitySale?,
        onSubmit: @escaping (EquitySaleInput) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.memberID = memberID
        self.grants = grants
        self.rows = rows
        self.editing = editing
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(
            initialValue: editing.map(SaleDraft.init(sale:))
                ?? SaleDraft(grants: grants, today: PayslipDraft.todayIso()))
    }

    private var grant: EquityGrant? { grants.first { $0.id == draft.grantID } }

    private var limitError: String? {
        guard let grant, draft.units > 0 else { return nil }
        return EquityLimits.saleError(
            grant, exercises: rows.exercises, sales: rows.sales, quantity: draft.units,
            ignoring: editing?.id)
    }

    private var grantSelection: Binding<String> {
        Binding(get: { draft.grantID ?? "" }, set: { draft.grantID = $0 })
    }

    var body: some View {
        FormCard {
            SelectInput(
                label: "Grant", options: grants.map { ($0.id, $0.label) },
                selection: grantSelection)
            IsoDateField(label: "Sale date", clearable: false, iso: $draft.soldOn)
            WholeNumberInput(label: "Shares sold", text: $draft.quantity)
            TextInput(label: "Price per share", prefix: "$", decimal: true, text: $draft.price)
            TextInput(
                label: "Fees", description: "Brokerage and other costs of the sale.", prefix: "$",
                decimal: true, text: $draft.fee)
            if let message = error ?? limitError { FormError(message: message) }
            FormFooter(
                submitLabel: editing == nil ? "Add sale" : "Save changes",
                canSubmit: grant != nil
                    && draft.input(memberID: memberID, limitError: limitError) != nil,
                submitting: submitting,
                onSubmit: {
                    Task {
                        guard grant != nil,
                            let input = draft.input(memberID: memberID, limitError: limitError)
                        else { return }
                        await submit(
                            { try await onSubmit(input) }, submitting: $submitting, error: $error,
                            fallback: EquityPresentation.saleSaveError)
                    }
                }, onCancel: onCancel)
        }
    }
}
