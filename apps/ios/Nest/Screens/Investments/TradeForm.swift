import SwiftUI

/// The add and edit form for one trade, in the PWA's bordered form card.
struct TradeForm: View {
    let memberID: String
    let editing: Trade?
    let presentation: InvestmentsPresentation
    let figures: (TradeFiguresInput) async -> TradeFigures?
    /// Shown first: the document picker and what became of it.
    var attachment: AnyView?
    /// Whether the attachment is still being stored or read, so a save would send no document.
    var busy = false
    /// Whether the fields are shown. Hidden, the form is just its attachment and notice.
    var showFields = true
    /// The fields a document left for the member to check.
    var check: [String] = []
    var submitLabel: String?
    var cancelLabel = "Cancel"
    /// Registers the form's own save with a bulk review's Save selected.
    var register: ((@escaping @MainActor () async -> DraftSaveOutcome) -> Void)?
    let onSubmit: (TradeInput) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: TradeDraft
    @State private var parsed: TradeFigures?
    @State private var submitting = false
    @State private var error: String?

    init(
        memberID: String, editing: Trade?, initial: TradeValues? = nil,
        presentation: InvestmentsPresentation,
        figures: @escaping (TradeFiguresInput) async -> TradeFigures?,
        attachment: AnyView? = nil, busy: Bool = false, showFields: Bool = true,
        check: [String] = [], submitLabel: String? = nil, cancelLabel: String = "Cancel",
        register: ((@escaping @MainActor () async -> DraftSaveOutcome) -> Void)? = nil,
        onSubmit: @escaping (TradeInput) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.memberID = memberID
        self.editing = editing
        self.presentation = presentation
        self.figures = figures
        self.attachment = attachment
        self.busy = busy
        self.showFields = showFields
        self.check = check
        self.submitLabel = submitLabel
        self.cancelLabel = cancelLabel
        self.register = register
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        let today = Self.iso(Date())
        _draft = State(
            initialValue: editing.map(TradeDraft.init(trade:))
                ?? initial.map { TradeDraft(values: $0, today: today) }
                ?? TradeDraft(today: today))
    }

    private var candidate: TradeInput? {
        busy ? nil : draft.input(memberID: memberID, figures: parsed)
    }
    private var isRepeat: Bool {
        candidate.map { presentation.isRepeat($0, ignoring: editing?.id) } ?? false
    }

    var body: some View {
        FormCard {
            if let attachment { attachment }
            if let notice = InvestmentsPresentation.checkNotice(check) {
                Callout(tone: .warning, text: notice)
            }
            if showFields { fields }
            if let error { FormError(message: error) }
            FormFooter(
                submitLabel: submitLabel ?? (editing == nil ? "Add trade" : "Save changes"),
                cancelLabel: cancelLabel, canSubmit: candidate != nil, submitting: submitting,
                onSubmit: { Task { await submit() } }, onCancel: onCancel)
        }
        .task(id: draft.figuresInput) { parsed = await figures(draft.figuresInput) }
        .onAppear { register? { await submit() } }
    }

    @ViewBuilder private var fields: some View {
        SegmentedInput(
            options: [(TradeSide.buy, "Buy"), (TradeSide.sell, "Sell")], selection: $draft.side
        )
        .accessibilityLabel("Trade side")
        HStack(alignment: .top, spacing: FormMetric.xs) {
            TextInput(label: "Ticker", placeholder: "e.g. VAS", text: $draft.ticker)
            LabelledField(label: "Date") {
                DatePicker("Date", selection: dateBinding, displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.locale, Locale(identifier: "en_AU"))
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
            }
        }
        TextInput(
            label: "Units", description: "Up to six decimal places.", decimal: true,
            text: $draft.units)
        HStack(alignment: .top, spacing: FormMetric.xs) {
            TextInput(
                label: "Price per unit", description: "Up to six decimal places.", prefix: "$",
                decimal: true, text: $draft.price)
            TextInput(label: "Brokerage fee", prefix: "$", decimal: true, text: $draft.fee)
        }
        if isRepeat {
            Callout(tone: .warning, text: InvestmentsPresentation.duplicateWarning)
        }
    }

    @discardableResult
    private func submit() async -> DraftSaveOutcome {
        guard let input = candidate, !submitting else { return .needsAttention }
        submitting = true
        error = nil
        defer { submitting = false }
        do {
            try await onSubmit(input)
            return .saved
        } catch {
            self.error = InvestmentsPresentation.saveError
            return .needsAttention
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { Self.date(draft.tradedOn) ?? Date() },
            set: { draft.tradedOn = Self.iso($0) })
    }

    private static func date(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar(identifier: .gregorian).date(
            from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func iso(_ date: Date) -> String {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 1, parts.day ?? 1)
    }
}
