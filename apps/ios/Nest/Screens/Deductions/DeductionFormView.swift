import SwiftUI

/// A receipt already stored and read by a bulk upload: the form opens on what was read,
/// attached to that file under its id, with no picker; the queue owns the file's cleanup.
struct DeductionFormDraft: Equatable {
    let id: String
    let path: String
    let extraction: DeductionExtraction?
    let category: DeductionCategory
}

/// What editing a deduction's stored receipt calls into.
struct ReceiptControls {
    var receipt: DeductionReceipt?
    var upload: (UploadRules.PreparedFile) async throws -> Void
    var remove: (DeductionReceipt) -> Void
}

/// The add/edit form for one deduction, the native `DeductionForm`.
///
/// Adding opens on the receipt prompt alone (the kind of deduction, the receipt input,
/// and "Enter details manually"); the fields appear once a receipt has been stored and
/// read (or could not be), or when the member chooses to type, and stay once shown. A
/// draft and an edit open on their fields. A work expense is entered on a dollar, a
/// distance or an hours basis; work use apportions a dollar-basis work expense.
struct DeductionFormView: View {
    @State private var form: DeductionFormState
    @State private var attachment: ReceiptAttachment?
    let draft: DeductionFormDraft?
    var addLabel = "deduction"
    var cancelLabel = "Cancel"
    /// Hands several receipts picked at once to a bulk upload, closing the form.
    var onAddFiles: (([UploadRules.PickedFile], DeductionCategory) -> Void)?
    var receiptControls: ReceiptControls?
    var controls: DraftControls?
    let figures: (DeductionFiguresInput) async -> DeductionFigures
    let onSubmit: (DeductionSubmission) async throws -> Void
    var onCancel: (() -> Void)?

    @State private var revealed = false
    @State private var detailsToggled: Bool
    @State private var submitting = false
    @State private var error: String?
    @State private var receiptError: String?

    private struct Invalid: Error {}

    init(
        state: DeductionFormState, attachment: ReceiptAttachment? = nil,
        draft: DeductionFormDraft? = nil, addLabel: String = "deduction",
        cancelLabel: String = "Cancel",
        onAddFiles: (([UploadRules.PickedFile], DeductionCategory) -> Void)? = nil,
        receiptControls: ReceiptControls? = nil, controls: DraftControls? = nil,
        figures: @escaping (DeductionFiguresInput) async -> DeductionFigures,
        onSubmit: @escaping (DeductionSubmission) async throws -> Void,
        onCancel: (() -> Void)? = nil
    ) {
        _form = State(initialValue: state)
        _attachment = State(initialValue: attachment)
        self.draft = draft
        self.addLabel = addLabel
        self.cancelLabel = cancelLabel
        self.onAddFiles = onAddFiles
        self.receiptControls = receiptControls
        self.controls = controls
        self.figures = figures
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        let initial = state.initial
        _detailsToggled = State(
            initialValue: initial.map {
                $0.workUsePercent < 100 || ($0.groupId != nil && $0.category != .donation)
            } ?? false)
    }

    private var receiptSettled: Bool {
        guard let state = attachment?.state else { return false }
        return state != .idle && state != .uploading && state != .reading
    }
    private var showFields: Bool { !form.adding || draft != nil || revealed || receiptSettled }
    private var showDetails: Bool { form.adding || detailsToggled }
    private var receiptBusy: Bool { attachment?.busy ?? false }
    private var canSubmit: Bool { form.canSubmit(receiptBusy: receiptBusy) }

    var body: some View {
        FormCard {
            if form.adding && form.openedFrom?.kind != "donations" {
                SegmentedInput(
                    options: form.categoryOptions.map {
                        (value: $0, label: Self.categoryLabel($0))
                    },
                    selection: $form.category)
            }
            if let draft, let extraction = draft.extraction {
                ReadNote(filledNothing: extraction.isEmpty)
            }
            if form.adding && draft == nil { receiptPrompt }
            if showFields { fields }
            if let receiptError { FormError(message: receiptError) }
            if let error { FormError(message: error) }
            FormFooter(
                submitLabel: form.adding ? "Add \(addLabel)" : "Save changes",
                cancelLabel: cancelLabel, canSubmit: canSubmit, submitting: submitting,
                onSubmit: { Task { try? await submit() } }, onCancel: onCancel)
        }
        .task(id: form.figuresInput) { form.figures = await figures(form.figuresInput) }
        .onChange(of: receiptSettled) { _, settled in if settled { revealed = true } }
        .onAppear {
            controls?.register {
                do {
                    try await submit()
                    return .saved
                } catch { return .needsAttention }
            }
        }
        .onDisappear { attachment?.abandon() }
    }

    static func categoryLabel(_ category: DeductionCategory) -> String {
        switch category {
        case .workExpense: "Work expense"
        case .donation: "Donation"
        case .taxAgentFees: "Tax agent fee"
        }
    }

    // MARK: Receipt prompt

    private var receiptPrompt: some View {
        VStack(alignment: .leading, spacing: 6) {
            ReceiptPicker(
                label: onAddFiles != nil ? "Receipts" : "Receipt",
                description: showFields
                    ? "Any file, up to 25 MB. Stored privately, then read to pre-fill the details below where it can be — which you confirm. Pick again to replace it."
                    : "\(onAddFiles != nil ? "Add a receipt or several, or drop them here. " : "")We'll read the details for you to check — no typing needed. Any file, up to 25 MB.",
                placeholder: onAddFiles != nil ? "Attach a receipt or several" : "Attach a receipt",
                multiple: onAddFiles != nil, disabled: receiptBusy, onFiles: handleFiles)
            if let attachment { DeductionExtractionNote(state: attachment.state) }
            if attachment?.path != nil {
                HStack {
                    Text("Receipt attached").font(.system(size: 12)).foregroundStyle(NestColor.text)
                    Spacer()
                    Button { Task { await attachment?.remove() } } label: {
                        Image(systemName: "trash").font(.system(size: 14))
                            .foregroundStyle(NestColor.negative).frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain).accessibilityLabel("Remove receipt")
                }
            }
            if !showFields {
                Button("Enter details manually") { revealed = true }
                    .buttonStyle(.plain).font(.system(size: 12))
                    .foregroundStyle(NestColor.brand).disabled(receiptBusy)
            }
        }
    }

    private func handleFiles(_ files: [UploadRules.PickedFile]) {
        guard !receiptBusy else { return }
        if let onAddFiles, files.count > 1 {
            onAddFiles(files, form.category)
            onCancel?()
            return
        }
        guard let file = files.first, let attachment else { return }
        Task {
            await attachment.add(file, category: { form.category }, onExtracted: { form.prefill($0) })
        }
    }

    // MARK: Fields

    private func hint(_ text: String) -> String? { form.adding ? text : nil }

    private var fields: some View {
        VStack(alignment: .leading, spacing: FormMetric.xs) {
            TextInput(
                label: "Description", placeholder: "e.g. Home office running costs",
                text: Binding(get: { form.description }, set: { form.setDescription($0) }))
            HStack(alignment: .top, spacing: 6) {
                if form.isDerived {
                    TextInput(
                        label: form.isHours ? "Hours worked from home" : "Kilometres travelled",
                        description: hint(derivedHint), suffix: form.isHours ? " hours" : " km",
                        decimal: true,
                        text: form.isHours ? $form.hours : $form.distance)
                } else {
                    TextInput(
                        label: "Amount",
                        description: hint(
                            form.apportionable
                                ? "What the expense cost in full."
                                : "The receipted amount, claimed in full."),
                        prefix: "$", decimal: true,
                        text: Binding(get: { form.amount }, set: { form.setAmount($0) }))
                }
                dateField
            }
            if form.isDerived {
                (Text("Deductible amount: ") + Text(MoneyFormat.cents(form.computedAmountCents)).bold())
                    .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            }
            if form.overCap {
                Callout(
                    tone: .warning,
                    text:
                        "Over the ATO's \(Self.grouped(Int(form.figures.maxClaimableKm)))km cap per car, per year for the cents-per-kilometre method. Kilometres beyond the cap need the logbook method or actual costs instead."
                )
            }
            if !form.adding {
                Button(detailsToggled ? "Fewer details" : "More details") { detailsToggled.toggle() }
                    .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(NestColor.brand)
            }
            if form.adding && form.basisApplies {
                SegmentedInput(
                    options: [
                        (value: DeductionBasis.amount, label: "Dollar"),
                        (value: .distance, label: "Distance (km)"),
                        (value: .hours, label: "Hours at home"),
                    ], selection: $form.chosenBasis)
            }
            workUseAndGroup
            if showDetails && form.apportionable && form.workUseValid && form.workUsePercent != 100 {
                (Text("Deductible amount: ") + Text(MoneyFormat.cents(form.apportionedAmountCents)).bold())
                    .font(.system(size: 14)).foregroundStyle(NestColor.dimmedText)
            }
            receiptButtons
        }
    }

    private var derivedHint: String {
        form.isHours
            ? "At FY\(form.financialYear)'s \(Self.rate(form.figures.centsPerHour, "hr")) ATO fixed rate. Covers energy, internet, phone, and stationery; keep a timesheet."
            : "Work-related kilometres travelled, at FY\(form.financialYear)'s \(Self.rate(form.figures.centsPerKm, "km")) ATO rate."
    }

    @ViewBuilder private var workUseAndGroup: some View {
        let showWorkUse = showDetails && form.apportionable
        let showGroup =
            showDetails && form.openedFrom == nil && !form.isDonation && !form.standardGroups.isEmpty
        if showWorkUse || showGroup {
            HStack(alignment: .top, spacing: 6) {
                if showWorkUse {
                    TextInput(
                        label: "Work use %",
                        description: hint("The share used for work; 100% if it's for work only."),
                        suffix: "%", decimal: true, text: $form.workUse
                    )
                    .frame(maxWidth: showGroup ? 112 : .infinity)
                }
                if showGroup {
                    SelectInput(
                        label: "Group",
                        description: "File this under a group, or leave it on its own.",
                        options: groupOptions,
                        selection: $form.pickedGroupID)
                }
            }
        }
    }

    private var groupOptions: [(value: String?, label: String)] {
        var options: [(value: String?, label: String)] = [(nil, "None")]
        for group in form.standardGroups { options.append((group.id, group.name)) }
        return options
    }

    private var dateField: some View {
        LabelledField(label: "Date") {
            DatePicker(
                "Date",
                selection: Binding(
                    get: { Self.parseDate(form.date) ?? Date() },
                    set: { form.setDate(DeductionFormState.todayISO($0)) }),
                displayedComponents: .date
            )
            .labelsHidden()
            .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        }
    }

    @ViewBuilder private var receiptButtons: some View {
        if showDetails, !form.adding, let receiptControls {
            HStack(spacing: 6) {
                ReceiptReplaceButton(
                    label: receiptControls.receipt == nil ? "Add receipt" : "Replace receipt",
                    upload: receiptControls.upload, error: $receiptError)
                if let receipt = receiptControls.receipt {
                    Button { receiptControls.remove(receipt) } label: {
                        Image(systemName: "trash").font(.system(size: 14))
                            .foregroundStyle(NestColor.negative).frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain).accessibilityLabel("Delete receipt")
                }
            }
        }
    }

    // MARK: Submit

    private func submit() async throws {
        guard canSubmit else { throw Invalid() }
        submitting = true
        error = nil
        defer { submitting = false }
        let id = form.initial?.id ?? draft?.id ?? attachment?.deductionID ?? UUID().uuidString.lowercased()
        let path = form.adding ? (draft?.path ?? attachment?.path) : nil
        do {
            if let controls, draft != nil {
                try await controls.save {
                    try await onSubmit(DeductionSubmission(id: id, write: form.write(), receiptPath: path))
                }
            } else {
                try await onSubmit(DeductionSubmission(id: id, write: form.write(), receiptPath: path))
            }
            if form.adding { attachment?.keep() }
        } catch {
            self.error = "Could not save this deduction. Please try again."
            throw error
        }
    }

    // MARK: Formatting

    static func rate(_ cents: Double, _ unit: String) -> String {
        "\(DeductionsPresentation.number((cents * 100).rounded() / 100))c/\(unit)"
    }

    static func grouped(_ value: Int) -> String {
        value.formatted(.number.grouping(.automatic).locale(Locale(identifier: "en_AU")))
    }

    static func parseDate(_ iso: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(iso.prefix(10)))
    }
}

/// The note under the receipt input saying a read filled the fields.
struct ReadNote: View {
    let filledNothing: Bool

    var body: some View {
        Callout(
            tone: .info, title: "Read from the receipt",
            text: filledNothing
                ? "Nothing on the receipt could be filled in for you."
                : "The details below were extracted from the receipt by AI — check them against it before saving."
        )
    }
}

/// Where reading the attached receipt has got to, shown under the file input. Every
/// failure reads as what it is and none of them blocks the save.
struct DeductionExtractionNote: View {
    let state: ReceiptAttachment.State

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .uploading, .reading:
            HStack(spacing: NestSpacing.xs) {
                ProgressView().controlSize(.small)
                Text(state == .uploading ? "Storing the receipt…" : "Reading the receipt…")
                    .font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            }
        case .read(let filledNothing):
            ReadNote(filledNothing: filledNothing)
        case .failure(let outcome):
            switch outcome {
            case .notConfigured(let message), .outOfCredit(let message), .keyRejected(let message),
                .unsupported(let message):
                Text(message).font(.system(size: 12)).foregroundStyle(NestColor.dimmedText)
            case .notReceipt(let message, let reason):
                Callout(
                    tone: .warning,
                    text: "\(message)\(reason.map { " \($0)" } ?? "") Enter the details by hand.")
            case .failed(let message):
                Callout(tone: .warning, text: message)
            case .read:
                EmptyView()
            }
        }
    }
}

/// The edit form's control to store or replace a deduction's receipt.
private struct ReceiptReplaceButton: View {
    let label: String
    let upload: (UploadRules.PreparedFile) async throws -> Void
    @Binding var error: String?
    @State private var showImporter = false

    var body: some View {
        Button(label) { showImporter = true }
            .buttonStyle(FormButtonStyle(kind: .compact))
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item]) { result in
                guard case .success(let url) = result else { return }
                error = nil
                Task {
                    let scoped = url.startAccessingSecurityScopedResource()
                    let copy = DeductionsViewModel.copyToTemporary(url, name: url.lastPathComponent)
                    if scoped { url.stopAccessingSecurityScopedResource() }
                    guard let copy else { error = ReceiptAttachment.uploadFailedMessage; return }
                    let picked = UploadRules.PickedFile(name: url.lastPathComponent, url: copy)
                    switch await Task.detached(operation: { UploadRules.prepare(picked) }).value {
                    case .tooLarge(let message): error = message
                    case .unreadable: error = ReceiptAttachment.uploadFailedMessage
                    case .ready(let file):
                        do { try await upload(file) } catch { self.error = ReceiptAttachment.uploadFailedMessage }
                    }
                }
            }
    }
}
