import SwiftUI

/// What a payslip form opens on.
enum PayslipFormMode {
    /// A new payslip, optionally attaching a document.
    case add
    /// An existing payslip and its lines.
    case edit(Payslip, lines: [PayslipLine])
    /// A document already stored and read by a bulk upload: the form opens on what was
    /// read, attached to that file under its id, with no picker.
    case draft(id: String, path: String, extraction: PayslipExtraction?)
}

/// Add/edit form for one payslip, tagged to the member the section belongs to, mirroring
/// the PWA's `PayslipForm`. The financial year is derived from the payment date (or the
/// pay period's end where the slip states none) and shown back. Attaching a document
/// stores and reads it: the figures it finds pre-fill the fields that are not already the
/// member's own, and its itemisation fills the earnings and tax lines on the same footing.
/// An inverted pay period blocks submission.
struct PayslipFormView: View {
    let member: Member
    let inflows: [Inflow]
    let mode: PayslipFormMode
    var cancelLabel = "Cancel"
    var controls: DraftControls?
    var onAddFiles: (([UploadRules.PickedFile]) -> Void)?
    let onSubmit: (PayslipSubmission) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: PayslipDraft
    @State private var attachment: PayslipAttachmentModel
    @State private var draftRead: PrefillSummary?
    @State private var error: String?
    @State private var submitting = false
    @State private var picking = false
    private let isDraft: Bool
    private let isEditing: Bool
    private let storedPath: String?
    private let options: [InflowOption]

    init(
        member: Member, inflows: [Inflow], mode: PayslipFormMode, household: String,
        financialYear: Int, service: any PayslipsServicing, today: String = PayslipDraft.todayIso(),
        cancelLabel: String = "Cancel", controls: DraftControls? = nil,
        onAddFiles: (([UploadRules.PickedFile]) -> Void)? = nil,
        onSubmit: @escaping (PayslipSubmission) async throws -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.member = member
        self.inflows = inflows
        self.mode = mode
        self.cancelLabel = cancelLabel
        self.controls = controls
        self.onAddFiles = onAddFiles
        self.onSubmit = onSubmit
        self.onCancel = onCancel

        let options = inflows.filter { $0.taxable && $0.memberId == member.id }
            .map { InflowOption(value: $0.id, label: $0.name) }
        self.options = options
        let model: PayslipDraft
        let id: String?
        switch mode {
        case .add:
            model = PayslipDraft(today: today)
            id = nil
            isDraft = false
            isEditing = false
            storedPath = nil
        case .edit(let payslip, let lines):
            model = PayslipDraft(initial: payslip, lines: lines, today: today)
            id = payslip.id
            isDraft = false
            isEditing = true
            storedPath = payslip.filePath
        case .draft(let draftID, _, let extraction):
            model = PayslipDraft(today: today)
            id = draftID
            isDraft = true
            isEditing = false
            storedPath = nil
            // What the bulk upload read is applied once, as the form opens.
            if let extraction { _draftRead = State(initialValue: model.prefill(extraction, options: options)) }
        }
        _draft = State(initialValue: model)
        _attachment = State(
            initialValue: PayslipAttachmentModel(
                payslipID: id, household: household, financialYear: financialYear, service: service,
                apply: { model.prefill($0, options: options) }))
    }

    var body: some View {
        NestCard(padding: NestSpacing.sm) {
            VStack(alignment: .leading, spacing: NestSpacing.xs) {
                if isDraft, let read = draftRead { ReadFromSlipNote(summary: read) }
                if !isDraft { documentInput }
                if !isDraft { ExtractionNote(state: attachment.state) }
                dates
                if let year = draft.financialYear { financialYearNote(year) }
                AdaptiveGrid(items: AmountSlot.quartet, compact: 2, regular: 4) { slot in
                    AmountField(label: slot.label, text: amountBinding(slot.field))
                }
                Text(Self.taxTotalNote).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                PayslipEarningsLines(draft: draft, options: options)
                PayslipTaxLines(draft: draft)
                AmountField(
                    label: "Salary sacrifice",
                    description: "Concessional sacrifice shown separately on the slip.",
                    text: amountBinding(.salarySacrifice))
                AdaptiveGrid(items: AmountSlot.yearToDate, compact: 1, regular: 3) { slot in
                    AmountField(label: slot.label, text: amountBinding(slot.field))
                }
                FieldLabel(label: "Note") {
                    TextField("e.g. Includes back-pay", text: $draft.note)
                        .textFieldStyle(.plain).modifier(FieldChrome())
                }
                if let error {
                    Text(error).font(.system(size: 14)).foregroundStyle(NestColor.negative)
                        .accessibilityAddTraits(.isStaticText)
                }
                HStack(spacing: NestSpacing.xs) {
                    Button(submitLabel) { Task { _ = await submit() } }
                        .buttonStyle(NestPrimaryButtonStyle())
                        .disabled(!draft.canSubmit(busy: attachment.isBusy) || submitting)
                    Button(cancelLabel) { cancel() }
                        .buttonStyle(NestSecondaryButtonStyle())
                }
            }
        }
        .filePicker(isPresented: $picking, allowsMultiple: onAddFiles != nil && !isEditing) { files in
            handle(files)
        }
        .onAppear {
            controls?.register { await submit() }
        }
        .onDisappear { attachment.leave() }
    }

    // MARK: Parts

    private static let taxTotalNote =
        "Tax withheld — here and year to date — is the slip’s tax total: PAYG income tax plus any STSL study-loan component, not the PAYG line alone. The estimate’s liability already includes the HELP repayment that STSL pays, so only the total nets against it. Split it into its components under Tax lines below."

    private var submitLabel: String {
        submitting ? "Saving…" : isEditing ? "Save changes" : "Add payslip"
    }

    private var multiple: Bool { onAddFiles != nil && !isEditing }

    private var documentInput: some View {
        let hasDocument = storedPath != nil
        let label = multiple ? "Payslip documents" : "Payslip document"
        let description =
            hasDocument
            ? "Any file, up to 25 MB. Read to pre-fill the figures below where it can be, and replaces the document already attached."
            : "\(multiple ? "Add a payslip or several: one is read into the figures below to check, several are each read into their own payslip to review. " : "")Any file, up to 25 MB. Stored privately, then read to pre-fill the figures below where it can be — which you confirm."
        return FieldLabel(label: label, description: description) {
            HStack(spacing: NestSpacing.xs) {
                Button { picking = true } label: {
                    HStack {
                        Text(
                            attachment.fileName
                                ?? (multiple ? "Attach a payslip or several" : "Attach the slip")
                        )
                        .foregroundStyle(attachment.fileName == nil ? NestColor.dimmedText : NestColor.text)
                        .lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 0)
                    }
                    .modifier(FieldChrome())
                }
                .buttonStyle(.plain)
                .disabled(attachment.isBusy)
                if attachment.fileName != nil {
                    Button { Task { await attachment.choose(nil) } } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(NestColor.dimmedText)
                    }
                    .buttonStyle(.plain)
                    .disabled(attachment.isBusy)
                    .accessibilityLabel("Remove the attached document")
                }
            }
        }
    }

    private var dates: some View {
        AdaptiveGrid(items: DateSlot.all, compact: 1, regular: 3) { slot in
            IsoDateField(
                label: slot.label, placeholder: slot.placeholder,
                error: slot.field == .periodEnd && draft.periodInverted
                    ? "Must be on or after the period start." : nil,
                clearable: slot.clearable, iso: dateBinding(slot.field))
        }
    }

    private func financialYearNote(_ year: Int) -> some View {
        Text(
            draft.paidOn == nil
                ? "Filed under FY\(year), derived from the pay period end. Pay is taxed in the year it lands, so entering a payment date files the slip by that instead."
                : "Filed under FY\(year), derived from the payment date — pay is taxed in the year it lands, whatever period earned it."
        )
        .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
    }

    private func amountBinding(_ field: ExtractedAmountField) -> Binding<String> {
        Binding(get: { draft.amount(field) }, set: { draft.setAmount(field, Self.sanitised($0)) })
    }

    private func dateBinding(_ field: ExtractedDateField) -> Binding<String?> {
        Binding(
            get: {
                switch field {
                case .periodStart: draft.periodStart
                case .periodEnd: draft.periodEnd
                case .paidOn: draft.paidOn
                }
            }, set: { draft.setDate(field, $0) })
    }

    /// A figure takes digits and one decimal point, as the PWA's non-negative `MoneyInput`.
    static func sanitised(_ text: String) -> String {
        var seenPoint = false
        return String(
            text.filter { character in
                if character.isNumber { return true }
                if character == ".", !seenPoint {
                    seenPoint = true
                    return true
                }
                return false
            })
    }

    // MARK: Actions

    private func handle(_ files: [UploadRules.PickedFile]) {
        guard !attachment.isBusy else { return }
        if multiple, files.count > 1, let onAddFiles {
            onAddFiles(files)
            onCancel()
            return
        }
        Task { await attachment.choose(files.first) }
    }

    private func cancel() {
        attachment.leave()
        onCancel()
    }

    /// Validates and saves; the outcome Save selected counts.
    private func submit() async -> DraftSaveOutcome {
        guard draft.canSubmit(busy: attachment.isBusy) else { return .needsAttention }
        let stored: PayslipAttachment?
        if case .draft(let id, let path, _) = mode {
            stored = PayslipAttachment(payslipId: id, path: path)
        } else {
            stored = attachment.attachment
        }
        guard
            let submission = draft.submission(
                id: attachment.payslipID, memberID: member.id, attachment: stored)
        else { return .needsAttention }
        submitting = true
        error = nil
        defer { submitting = false }
        do {
            try await onSubmit(submission)
            attachment.keep()
            return .saved
        } catch {
            self.error = "Could not save this payslip. Please try again."
            return .needsAttention
        }
    }
}

private struct AmountSlot: Identifiable {
    let field: ExtractedAmountField
    let label: String
    var id: String { field.rawValue }

    static let quartet = [
        AmountSlot(field: .gross, label: "Gross"),
        AmountSlot(field: .taxWithheld, label: "Tax withheld"),
        AmountSlot(field: .super, label: "Super"),
        AmountSlot(field: .net, label: "Net"),
    ]
    static let yearToDate = [
        AmountSlot(field: .ytdGross, label: "YTD gross"),
        AmountSlot(field: .ytdTaxWithheld, label: "YTD tax withheld"),
        AmountSlot(field: .ytdSuper, label: "YTD super"),
    ]
}

private struct DateSlot: Identifiable {
    let field: ExtractedDateField
    let label: String
    var placeholder = ""
    var clearable = true
    var id: String { field.rawValue }

    static let all = [
        DateSlot(field: .periodStart, label: "Period start"),
        DateSlot(field: .periodEnd, label: "Period end"),
        DateSlot(field: .paidOn, label: "Paid on", placeholder: "When the pay landed"),
    ]
}

/// What a successful read amounts to, in one line.
private struct ReadFromSlipNote: View {
    let summary: PrefillSummary

    var body: some View {
        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
            Text("Read from the slip").font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NestColor.info)
            Text(
                summary.isEmpty
                    ? "Nothing on the slip could be filled in for you."
                    : "The details below were extracted from the document by AI — check them against it before saving."
            )
            .font(NestFont.caption).foregroundStyle(NestColor.text)
        }
        .padding(NestSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            NestColor.info.opacity(0.12),
            in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
    }
}

/// Where attaching a slip has got to, shown under the file picker. Every failure reads as
/// what it is, and none of them blocks the save.
private struct ExtractionNote: View {
    let state: ExtractionState

    var body: some View {
        switch state {
        case .idle: EmptyView()
        case .uploading, .reading:
            HStack(spacing: NestSpacing.xs) {
                ProgressView().controlSize(.small)
                Text(state == .uploading ? "Storing the slip…" : "Reading the slip…")
                    .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            }
        case .read(let summary): ReadFromSlipNote(summary: summary)
        case .failure(let outcome):
            switch outcome {
            case .notConfigured(let message), .outOfCredit(let message),
                .keyRejected(let message), .unsupported(let message):
                Text(message).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
            case .notPayslip(let message, let reason):
                UploadAlert(text: "\(message)\(reason.map { " \($0)" } ?? "") Enter the figures by hand.")
            case .failed(let message): UploadAlert(text: message)
            case .read: EmptyView()
            }
        }
    }
}
