import SwiftUI

/// The add/edit form, mirroring the PWA's `InflowForm` field for field: the same
/// controls in the same order, with the same labels, descriptions and notes.
struct InflowFormView: View {
    let members: [Member]
    let initial: Inflow?
    let preview: (InflowFormState) async -> InflowDraftPreview?
    let onSubmit: (InflowInput) async throws -> Void
    let onCancel: () -> Void

    @State private var form: InflowFormState
    @State private var draftPreview: InflowDraftPreview?
    @State private var submitting = false
    @State private var error: String?

    init(
        members: [Member], initial: Inflow?,
        preview: @escaping (InflowFormState) async -> InflowDraftPreview?,
        onSubmit: @escaping (InflowInput) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.members = members
        self.initial = initial
        self.preview = preview
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _form = State(initialValue: InflowFormState(initial: initial, members: members))
    }

    private static func options<T>(_ values: [T], _ label: @escaping (T) -> String) -> [(T, String)] {
        values.map { ($0, label($0)) }
    }

    private var frequencyOptions: [(Frequency, String)] {
        InflowFormState.frequencies.map { ($0, InflowsPresentation.frequencyLabel($0, interval: nil)) }
    }

    private var payOptions: [(Frequency?, String)] {
        [(nil, "Same as above")] + frequencyOptions.map { (Optional($0.0), $0.1) }
    }

    private var noun: String { Self.periodNoun(form.schedule) }

    /// The unit of one period of a frequency, as `PERIOD_NOUN`.
    static func periodNoun(_ frequency: Frequency) -> String {
        switch frequency {
        case .weekly: "week"
        case .fortnightly: "fortnight"
        case .monthly: "month"
        case .quarterly: "quarter"
        case .biannual: "half-year"
        case .annual: "year"
        case .everyNWeeks, .everyNMonths: "period"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            InflowSegmented(
                options: [(true, "Taxable income"), (false, "Non-taxable inflow")],
                selection: Binding(get: { form.taxable }, set: { form.setTaxable($0) }))

            InflowField(label: "Name") { InflowTextInput(text: $form.name, identifier: "inflow-name") }

            if form.taxable {
                InflowField(label: "Member") {
                    InflowSelect(
                        options: members.map { ($0.id, $0.name) }, selection: $form.memberID)
                }
            }

            InflowField(label: "Type") {
                InflowSelect(
                    options: Self.options(form.typeOptions, InflowsPresentation.typeLabel),
                    selection: Binding(get: { form.type }, set: { form.setType($0) }))
            }

            InflowSegmented(
                options: [(false, "Recurring"), (true, "One-off")],
                selection: Binding(get: { form.isOneOff }, set: { form.setOneOff($0) }))

            if !form.isOneOff { recurringFields }
            amountFields
            if form.isOneOff { oneOffFields }
            payFields
            if let note = payNote { note }
            if form.arrivesAnnually { annualNote }
            switches
            if !form.isOneOff { dateFields }

            if let error {
                Text(error).font(.system(size: 14)).foregroundStyle(NestColor.negative)
            }
            HStack(spacing: NestSpacing.xs) {
                Button(submitting ? "Saving…" : (initial == nil ? "Add inflow" : "Save changes")) {
                    submit()
                }
                .buttonStyle(NestPrimaryButtonStyle())
                .disabled(!form.canSubmit || submitting)
                .opacity(form.canSubmit && !submitting ? 1 : 0.5)
                Button("Cancel", action: onCancel).buttonStyle(InflowSecondaryButtonStyle())
            }
        }
        .padding(NestSpacing.sm)
        .background(
            NestColor.surface,
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous)
                .strokeBorder(NestColor.border, lineWidth: 1)
        )
        .task(id: form) { draftPreview = await preview(form) }
    }

    // MARK: Sections

    @ViewBuilder private var recurringFields: some View {
        InflowField(
            label: "Frequency",
            description:
                "The period the figure below covers. A salary defined as a yearly number is Annually here however often it is paid — say the pay cycle under Paid. The app converts everything to fortnightly and annual."
        ) { InflowSelect(options: frequencyOptions, selection: $form.schedule) }
        if form.isEveryN {
            InflowField(
                label: "\(form.intervalUnit == "months" ? "Months" : "Weeks") in a period",
                description:
                    "How many \(form.intervalUnit) the figure below covers (e.g. 4 for an amount received every four \(form.intervalUnit))."
            ) { InflowTextInput(text: $form.interval, numeric: true) }
        }
    }

    @ViewBuilder private var amountFields: some View {
        if form.isWage {
            InflowField(label: "Hourly rate", description: "Your gross (before tax) hourly pay rate.") {
                InflowTextInput(text: $form.hourlyRate, prefix: "$", numeric: true)
            }
            InflowField(
                label: "Hours per \(noun)",
                description: "Hours worked over that period. Gross = rate × hours × periods."
            ) { InflowTextInput(text: $form.hours, numeric: true) }
        } else {
            InflowField(
                label: form.isOneOff ? "Amount" : "Amount per \(noun)", description: amountHint
            ) { InflowTextInput(text: $form.amount, prefix: "$", numeric: true, identifier: "inflow-amount") }
        }
    }

    private var amountHint: String {
        switch (form.isOneOff, form.taxable) {
        case (true, true): "Gross amount (before tax) of this single payment."
        case (true, false): "Amount received in this single payment; excluded from tax."
        case (false, true): "Gross pay (before tax) for one such period."
        case (false, false): "Amount received over one such period; excluded from tax."
        }
    }

    @ViewBuilder private var oneOffFields: some View {
        InflowField(
            label: "Paid on",
            description:
                "The single date this money lands on. It counts in full in the financial year that date falls in, and never in any other."
        ) { InflowDateInput(iso: $form.paidOn) }
        if form.taxable {
            InflowField(
                label: "Tax treatment",
                description:
                    "What the payment is for, which is what decides the concession it is taxed under rather than its size."
            ) {
                InflowSelect(
                    options: Self.options(InflowFormState.treatments, InflowsPresentation.treatmentLabel),
                    selection: $form.treatment)
            }
        }
        if form.needsYearsOfService {
            InflowField(
                label: "Completed years of service",
                description:
                    "Whole years worked for the employer. The tax-free amount is a base limit plus a set amount for each of them."
            ) { InflowTextInput(text: $form.yearsOfService, numeric: true) }
        }
        if let split = draftPreview?.split {
            splitPreview(split, capped: form.treatment == .employmentTermination)
        }
    }

    private func splitPreview(_ split: OneOffSplit, capped: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if split.taxFreeCents > 0 {
                note(
                    "\(MoneyFormat.cents(Int(split.taxFreeCents))) is tax free — excluded from assessable income entirely."
                )
            }
            note("\(MoneyFormat.cents(Int(split.assessableCents))) is assessable income.")
            if split.concessionalCents > 0 {
                note(
                    "\(MoneyFormat.cents(Int(split.concessionalCents))) of that is taxed at \(Self.ratePercent(split.concessionalRate)), plus the 2% Medicare levy."
                        + (capped
                            ? " Your other income for the year lowers that amount, which the Tax tab applies."
                            : ""))
            }
        }
    }

    /// A fractional rate as a percentage, at most two decimals, trailing zeros trimmed.
    static func ratePercent(_ rate: Double) -> String {
        let value = (rate * 100 * 100).rounded() / 100
        return (value == value.rounded() ? String(Int(value)) : String(value)) + "%"
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var payFields: some View {
        if form.taxable && !form.isOneOff {
            InflowField(
                label: "Paid",
                description:
                    "How often the money actually arrives, when that is not the period above. A yearly salary paid fortnightly is Annually above and Fortnightly here."
            ) { InflowSelect(options: payOptions, selection: $form.paySchedule) }
        }
        if form.isPayEveryN {
            InflowField(
                label: "\(form.payIntervalUnit == "months" ? "Months" : "Weeks") between payments",
                description:
                    "How many \(form.payIntervalUnit) apart each payment lands (e.g. 4 for once every four \(form.payIntervalUnit))."
            ) { InflowTextInput(text: $form.payInterval, numeric: true) }
        }
    }

    private var payNote: AnyView? {
        guard let payment = draftPreview?.perPayment, form.arrivesEvery else { return nil }
        let gap = payment.annualCents - payment.statedAnnualCents
        var text = "That is \(MoneyFormat.cents(Int(payment.cents))) each \(payment.noun)."
        if gap != 0 {
            text +=
                " A year of those payments comes to \(MoneyFormat.cents(Int(payment.annualCents))), \(MoneyFormat.cents(Int(abs(gap)))) \(gap < 0 ? "under" : "over") the \(MoneyFormat.cents(Int(payment.statedAnnualCents))) stated, because each payment rounds to the nearest cent."
        }
        return AnyView(note(text))
    }

    private var annualNote: some View {
        Text(
            "This says the money arrives once a year. If a yearly figure is paid more often than that, set Paid to the cycle it lands on — the amount above stays the yearly one."
        )
        .font(.system(size: 12)).foregroundStyle(NestColor.text)
        .padding(NestSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            NestColor.warning.opacity(0.16),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }

    @ViewBuilder private var switches: some View {
        if form.taxable && !form.isOneOff {
            InflowSwitch(
                label: "Arrives in every pay period",
                description:
                    "On for pay that lands every cycle. Off for pay that lands in only some of them — an on-call allowance paid on the fortnightly payrun, but only for the fortnights a shift was worked. The yearly figure still counts in full in the tax estimate, the budget, and available cash; a payslip simply stops expecting a share of it every period, and the year is where you read whether it is tracking.",
                isOn: $form.arrivesEveryPeriod)
            InflowSwitch(
                label: "Employer super accrues on this",
                description:
                    "On for ordinary time earnings — salary and wages, which the super guarantee is paid on. Off for an allowance paid on top, such as on-call: it is taxed in full, but no super accrues on it.",
                isOn: $form.attractsSuper)
        }
        if form.jointEligible {
            InflowSwitch(
                label: "Joint income",
                description:
                    "On for income both partners are assessed on — joint interest, jointly-held dividends, a jointly-owned rental. The tax estimate splits it between you at the percentage below; every projection still counts the whole amount as household cash.",
                isOn: $form.isJoint)
        }
        if form.joint {
            InflowField(
                label: "Split — % to \(form.primaryMemberName(members))",
                description:
                    "\(form.otherMemberName(members)): \(form.splitPercentValid ? InflowsPresentation.trimmed(100 - form.splitPercentValue) : "—")%"
            ) { InflowTextInput(text: $form.splitPercent, numeric: true) }
        }
    }

    @ViewBuilder private var dateFields: some View {
        InflowField(
            label: "Confirmed payday",
            description:
                "A real date this money has landed on, if you know one. Anchors the calendar feed's dates to it instead of a placeholder guess."
        ) { InflowDateInput(iso: $form.payAnchorDate) }
        InflowField(
            label: "Effective from",
            description:
                "Leave blank if this applies all financial year. To model a change — a pay rise, or an arrangement that ends — set an end date and add a second inflow starting the next day."
        ) { InflowDateInput(iso: $form.startsOn) }
        InflowField(label: "Effective until") { InflowDateInput(iso: $form.endsOn) }
    }

    private func submit() {
        guard let input = form.input, !submitting else { return }
        submitting = true
        error = nil
        Task {
            do {
                try await onSubmit(input)
            } catch {
                self.error = "Could not save this inflow. Please try again."
                submitting = false
            }
        }
    }
}
