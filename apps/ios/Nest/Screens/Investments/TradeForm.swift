import SwiftUI

/// The add and edit form for one trade, in the PWA's bordered form card.
struct TradeForm: View {
    let memberID: String
    let editing: Trade?
    let presentation: InvestmentsPresentation
    let figures: (TradeFiguresInput) async -> TradeFigures?
    let onSubmit: (TradeInput) async throws -> Void
    let onCancel: () -> Void

    @State private var draft: TradeDraft
    @State private var parsed: TradeFigures?
    @State private var submitting = false
    @State private var error: String?

    init(
        memberID: String, editing: Trade?, presentation: InvestmentsPresentation,
        figures: @escaping (TradeFiguresInput) async -> TradeFigures?,
        onSubmit: @escaping (TradeInput) async throws -> Void, onCancel: @escaping () -> Void
    ) {
        self.memberID = memberID
        self.editing = editing
        self.presentation = presentation
        self.figures = figures
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _draft = State(
            initialValue: editing.map(TradeDraft.init(trade:))
                ?? TradeDraft(today: Self.iso(Date())))
    }

    private var candidate: TradeInput? { draft.input(memberID: memberID, figures: parsed) }
    private var isRepeat: Bool {
        candidate.map { presentation.isRepeat($0, ignoring: editing?.id) } ?? false
    }

    var body: some View {
        FormCard {
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
            if let error { FormError(message: error) }
            FormFooter(
                submitLabel: editing == nil ? "Add trade" : "Save changes",
                canSubmit: candidate != nil, submitting: submitting,
                onSubmit: { Task { await submit() } }, onCancel: onCancel)
        }
        .task(id: draft.figuresInput) { parsed = await figures(draft.figuresInput) }
    }

    private func submit() async {
        guard let input = candidate, !submitting else { return }
        submitting = true
        error = nil
        do { try await onSubmit(input) } catch { self.error = InvestmentsPresentation.saveError }
        submitting = false
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

    private static func iso(_ date: Date) -> String {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 1, parts.day ?? 1)
    }
}
