import SwiftUI

/// A line's name and amount, with whatever it is measured against beside them, as the
/// PWA's `LineFields`. Every control is labelled by its line's kind and position.
private struct LineFields<Picker: View>: View {
    let draft: PayslipDraft
    let line: LineDraft
    let position: Int
    let kindLabel: String
    @ViewBuilder let picker: Picker

    var body: some View {
        HStack(alignment: .top, spacing: NestSpacing.xs) {
            VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                TextField(
                    line.kind == .tax ? "e.g. PAYG" : "e.g. Ordinary Hours",
                    text: Binding(
                        get: { line.label }, set: { value in draft.change(line.id) { $0.label = value } })
                )
                .textFieldStyle(.plain).modifier(FieldChrome())
                .accessibilityLabel("\(kindLabel) \(position) name")
                HStack(alignment: .top, spacing: NestSpacing.xs) {
                    HStack(spacing: NestSpacing.xxs) {
                        Text("$").foregroundStyle(NestColor.dimmedText)
                        TextField(
                            "Amount",
                            text: Binding(
                                get: { line.amount },
                                set: { value in
                                    draft.change(line.id) { $0.amount = Self.sanitised(value) }
                                })
                        )
                        .textFieldStyle(.plain)
                        #if os(iOS)
                            .keyboardType(.numbersAndPunctuation)
                        #endif
                    }
                    .modifier(FieldChrome())
                    .accessibilityLabel("\(kindLabel) \(position) amount")
                    picker
                }
            }
            Button { draft.removeLine(line.id) } label: {
                Image(systemName: "trash").font(.system(size: 16)).foregroundStyle(NestColor.negative)
                    .padding(NestSpacing.xs)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(kindLabel.lowercased()) \(position)")
        }
    }

    /// A line amount is signed (a line may reverse an overpayment): digits, one point, a leading minus.
    static func sanitised(_ text: String) -> String {
        var seenPoint = false
        var result = ""
        for (index, character) in text.enumerated() {
            if character.isNumber { result.append(character) }
            else if character == "-", index == 0 { result.append(character) }
            else if character == ".", !seenPoint {
                seenPoint = true
                result.append(character)
            }
        }
        return result
    }
}

/// How much of a printed total the lines account for. They need not sum to it, so the gap
/// is stated rather than corrected.
private struct AllocationNote: View {
    let unallocatedCents: Int
    let over: String
    let under: String

    var body: some View {
        Text(
            unallocatedCents == 0
                ? "Every dollar is itemised."
                : "\(MoneyFormat.cents(abs(unallocatedCents))) \(unallocatedCents > 0 ? over : under)"
        )
        .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
    }
}

private struct LinesHeader: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: 14, weight: .medium)).foregroundStyle(NestColor.text)
            Text(text).font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
        }
    }
}

private struct AddLineButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "plus").font(.system(size: 12, weight: .semibold))
                .foregroundStyle(NestColor.brand)
                .padding(.horizontal, NestSpacing.xs).padding(.vertical, NestSpacing.xxs)
                .background(
                    NestColor.brand.opacity(0.14),
                    in: RoundedRectangle(cornerRadius: NestRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// A payslip's earnings lines. Itemising is what measures the slip at all: each inflow's
/// lines are summed and measured against that inflow on its own.
struct PayslipEarningsLines: View {
    let draft: PayslipDraft
    let options: [InflowOption]

    var body: some View {
        let lines = draft.lines(of: .earning)
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            LinesHeader(
                title: "Earnings lines",
                text:
                    "Itemise the slip so each earning is measured against the inflow it draws on. Several lines may draw on the same inflow — ordinary hours and annual leave both draw on the salary — and an allowance that earns no super is left out of the expected super. The largest group’s inflow is the pay cycle the slip’s tax and super expectations are read from."
            )
            ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                LineFields(draft: draft, line: line, position: index + 1, kindLabel: "Earnings line") {
                    OptionPicker(
                        label: "Earnings line \(index + 1) draws on",
                        placeholder: options.isEmpty ? "No taxable inflows" : "Draws on",
                        options: options,
                        selection: Binding(
                            get: { line.sourceInflowId },
                            set: { value in draft.change(line.id) { $0.sourceInflowId = value } }))
                }
            }
            HStack(alignment: .firstTextBaseline) {
                AddLineButton(title: "Add earnings line") { draft.addLine(.earning) }
                Spacer()
                if !lines.isEmpty {
                    AllocationNote(
                        unallocatedCents: draft.unallocatedCents,
                        over: "of the gross is not itemised, and reads as gross above plan.",
                        under: "more than the gross is itemised, so a line or the gross is wrong.")
                }
            }
            if partiallyItemised(lines) {
                UploadAlert(
                    text:
                        "More of the gross is unitemised (\(MoneyFormat.cents(draft.unallocatedCents))) than itemised. Expected gross counts only the lines above, so the rest reads as a gross variance that large. Itemise the earnings that are missing, or remove the lines to leave the gross unmeasured."
                )
            }
        }
    }

    /// Half-itemising is the trap: itemise the allowance, leave the salary untyped, and the
    /// expected gross collapses to the allowance while the actual is the whole payment.
    private func partiallyItemised(_ lines: [LineDraft]) -> Bool {
        lines.contains { $0.sourceInflowId != nil } && draft.unallocatedCents > draft.allocatedCents
    }
}

/// A payslip's tax lines. Each is measured against the part of the liability it pays.
struct PayslipTaxLines: View {
    let draft: PayslipDraft

    private static let options = [
        InflowOption(value: PayslipTaxComponent.payg.rawValue, label: "PAYG income tax"),
        InflowOption(value: PayslipTaxComponent.stsl.rawValue, label: "STSL (study loan)"),
    ]

    var body: some View {
        let lines = draft.lines(of: .tax)
        VStack(alignment: .leading, spacing: NestSpacing.xs) {
            LinesHeader(
                title: "Tax lines",
                text:
                    "Itemise the slip’s TAX section so each withholding is measured against the part of the liability it pays: STSL against the compulsory HELP repayment, PAYG against the income tax and levies. The tax withheld above stays the printed total, which is what the year’s refund or bill is worked out from."
            )
            ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                LineFields(draft: draft, line: line, position: index + 1, kindLabel: "Tax line") {
                    OptionPicker(
                        label: "Tax line \(index + 1) pays", placeholder: "Pays down",
                        options: Self.options,
                        error: line.component == nil && line.isEntered ? "Say which part this pays." : nil,
                        clearable: false,
                        selection: Binding(
                            get: { line.component?.rawValue },
                            set: { value in
                                draft.change(line.id) { $0.component = value.flatMap(PayslipTaxComponent.init) }
                            }))
                }
            }
            HStack(alignment: .firstTextBaseline) {
                AddLineButton(title: "Add tax line") { draft.addLine(.tax) }
                Spacer()
                if !lines.isEmpty {
                    AllocationNote(
                        unallocatedCents: draft.unallocatedTaxCents,
                        over: "of the tax withheld is not itemised.",
                        under: "more than the tax withheld is itemised, so a line or the total is wrong.")
                }
            }
        }
    }
}
