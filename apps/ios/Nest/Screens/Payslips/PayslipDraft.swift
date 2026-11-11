import Foundation
import Observation

/// One line being edited: its amount held as the text typed. The two references are
/// exclusive, as the stored line's check constraint requires: an earnings line carries
/// the inflow it draws on and a tax line the component it pays.
struct LineDraft: Identifiable, Equatable, Sendable {
    /// Stable across removals, so a row keeps its inputs as its siblings go.
    let id: Int
    let kind: PayslipLineKind
    var label: String
    var amount: String
    var sourceInflowId: String?
    var component: PayslipTaxComponent?

    /// Whether a row has anything typed in it. A row left entirely blank is dropped on
    /// save rather than blocking it; one with anything in it has to be complete.
    var isEntered: Bool {
        !label.trimmingCharacters(in: .whitespaces).isEmpty || !amount.isEmpty
    }
}

/// What a pre-fill did, so the form can say whether a read gave it anything.
struct PrefillSummary: Equatable, Sendable {
    var filled: [String] = []
    var filledLines: [PayslipLineKind] = []

    var isEmpty: Bool { filled.isEmpty && filledLines.isEmpty }
}

/// The payslip form's state, mirroring the PWA's `usePayslipFields`,
/// `usePayslipLineDrafts` and `PayslipForm`.
///
/// Extraction is a convenience, not an authority: it fills a field only while the
/// member has left it alone, so a figure they typed is never quietly replaced by one a
/// model read. A field is the member's own once they edit it here, and every figure a
/// saved payslip holds is theirs from the start. Lines work the same way a kind at a
/// time: a read itemises a kind only while the member has left that kind alone, and the
/// read's lines stand in for the untouched rows of that kind.
@MainActor @Observable
final class PayslipDraft {
    var periodStart: String?
    var periodEnd: String?
    var paidOn: String?
    var amounts: [ExtractedAmountField: String]
    var note: String
    private(set) var lines: [LineDraft]

    private var claimed: Set<String> = []
    private var claimedKinds: Set<PayslipLineKind>
    private var nextLineID: Int

    /// Days a fortnightly pay period spans, less the inclusive end day.
    static let fortnightSpanDays = 13

    /// A form opened on `initial` (editing) or on a defaulted pay period ending `today`.
    init(initial: Payslip? = nil, lines initialLines: [PayslipLine] = [], today: String) {
        periodStart = initial?.periodStart ?? Self.isoDaysBefore(today, Self.fortnightSpanDays)
        periodEnd = initial?.periodEnd ?? today
        paidOn = initial?.paidOn
        note = initial?.note ?? ""
        amounts = [
            .gross: Self.dollars(initial?.grossCents),
            .taxWithheld: Self.dollars(initial?.taxWithheldCents),
            .super: Self.dollars(initial?.superCents),
            .net: Self.dollars(initial?.netCents),
            .salarySacrifice: Self.dollars(initial?.salarySacrificeCents),
            .ytdGross: Self.dollars(initial?.ytdGrossCents),
            .ytdTaxWithheld: Self.dollars(initial?.ytdTaxWithheldCents),
            .ytdSuper: Self.dollars(initial?.ytdSuperCents),
        ]
        lines = initialLines.enumerated().map { index, line in
            LineDraft(
                id: index, kind: line.kind, label: line.label,
                amount: Self.dollars(line.amountCents), sourceInflowId: line.sourceInflowId,
                component: line.taxComponent)
        }
        nextLineID = initialLines.count
        claimedKinds = Set(initialLines.map(\.kind))
        if initial != nil {
            // An existing payslip's figures are the member's own, confirmed when saved.
            for (field, text) in amounts where !text.isEmpty { claimed.insert(field.rawValue) }
            for (field, value) in [
                (ExtractedDateField.periodStart, periodStart), (.periodEnd, periodEnd), (.paidOn, paidOn),
            ] where value != nil { claimed.insert(field.rawValue) }
        }
    }

    // MARK: Editing

    func setDate(_ field: ExtractedDateField, _ value: String?) {
        switch field {
        case .periodStart: periodStart = value
        case .periodEnd: periodEnd = value
        case .paidOn: paidOn = value
        }
        claimed.insert(field.rawValue)
    }

    func setAmount(_ field: ExtractedAmountField, _ text: String) {
        amounts[field] = text
        claimed.insert(field.rawValue)
    }

    func amount(_ field: ExtractedAmountField) -> String { amounts[field] ?? "" }

    /// Edits one row, which makes its whole kind the member's own.
    func change(_ id: Int, _ edit: (inout LineDraft) -> Void) {
        guard let index = lines.firstIndex(where: { $0.id == id }) else { return }
        claimedKinds.insert(lines[index].kind)
        edit(&lines[index])
    }

    func addLine(_ kind: PayslipLineKind) {
        lines.append(
            LineDraft(id: nextLineID, kind: kind, label: "", amount: "", sourceInflowId: nil, component: nil))
        nextLineID += 1
    }

    func removeLine(_ id: Int) { lines.removeAll { $0.id == id } }

    func lines(of kind: PayslipLineKind) -> [LineDraft] { lines.filter { $0.kind == kind } }

    /// Writes an extraction over the fields and line kinds the member has not made their
    /// own, and reports which those were.
    @discardableResult
    func prefill(_ extraction: PayslipExtraction, options: [InflowOption]) -> PrefillSummary {
        var summary = PrefillSummary()
        for field in ExtractedDateField.allCases {
            guard let read = extraction.dates[field], !claimed.contains(field.rawValue) else { continue }
            summary.filled.append(field.rawValue)
            switch field {
            case .periodStart: periodStart = read
            case .periodEnd: periodEnd = read
            case .paidOn: paidOn = read
            }
        }
        for field in ExtractedAmountField.allCases {
            guard let read = extraction.amounts[field], !claimed.contains(field.rawValue) else { continue }
            summary.filled.append(field.rawValue)
            amounts[field] = Self.dollars(read)
        }

        let offered: [(kind: PayslipLineKind, lines: [(String, Int, PayslipTaxComponent?)])] = [
            (
                .earning,
                extraction.earnings.compactMap { line in line.amountCents.map { (line.label, $0, nil) } }
            ),
            (
                .tax,
                extraction.tax.compactMap { tax in
                    tax.line.amountCents.map { (tax.line.label, $0, tax.component) }
                }
            ),
        ]
        var replaced: Set<PayslipLineKind> = []
        var drafts: [LineDraft] = []
        for section in offered where !section.lines.isEmpty && !claimedKinds.contains(section.kind) {
            summary.filledLines.append(section.kind)
            replaced.insert(section.kind)
            for (label, cents, component) in section.lines {
                // The model never says which inflow a line draws on; the label does,
                // where it names exactly one of the member's own.
                let inflow =
                    section.kind == .earning
                    ? PayslipExtractionReader.matchInflow(label: label, options: options) : nil
                drafts.append(
                    LineDraft(
                        id: nextLineID, kind: section.kind, label: label,
                        amount: Self.dollars(cents), sourceInflowId: inflow, component: component))
                nextLineID += 1
            }
        }
        lines = lines.filter { !replaced.contains($0.kind) } + drafts
        return summary
    }

    // MARK: Validation

    var enteredLines: [LineDraft] { lines.filter(\.isEntered) }

    /// A half-filled row is a mistake worth catching, and so is a tax line naming
    /// nothing it pays.
    var linesComplete: Bool {
        enteredLines.allSatisfy { line in
            !line.label.trimmingCharacters(in: .whitespaces).isEmpty && !line.amount.isEmpty
                && (line.kind == .earning || line.component != nil)
        }
    }

    var periodInverted: Bool {
        if let start = periodStart, let end = periodEnd { return end < start }
        return false
    }

    var quartetEntered: Bool {
        [ExtractedAmountField.gross, .taxWithheld, .super, .net].allSatisfy { !amount($0).isEmpty }
    }

    /// Whether the form can be saved; `busy` holds it while a document is stored or read.
    func canSubmit(busy: Bool) -> Bool {
        periodStart != nil && periodEnd != nil && !periodInverted && quartetEntered && linesComplete
            && !busy
    }

    var financialYear: Int? {
        periodEnd.map { PayslipsPresentation.financialYear(paidOn: paidOn, periodEnd: $0) }
    }

    /// Every earnings line typed, summed.
    var allocatedCents: Int { sum(lines(of: .earning).filter(\.isEntered)) }

    /// The gross less every earnings line typed.
    var unallocatedCents: Int { (Self.cents(amount(.gross)) ?? 0) - allocatedCents }

    /// The printed tax total less every tax line typed.
    var unallocatedTaxCents: Int {
        (Self.cents(amount(.taxWithheld)) ?? 0) - sum(lines(of: .tax).filter(\.isEntered))
    }

    private func sum(_ drafts: [LineDraft]) -> Int {
        drafts.reduce(0) { $0 + (Self.cents($1.amount) ?? 0) }
    }

    /// The submission for the member's payslip, under `id`, or nil when it cannot be built.
    func submission(id: String, memberID: String, attachment: PayslipAttachment?) -> PayslipSubmission? {
        guard let start = periodStart, let end = periodEnd, let year = financialYear else { return nil }
        let trimmed = note.trimmingCharacters(in: .whitespaces)
        return PayslipSubmission(
            id: id,
            input: PayslipInput(
                memberId: memberID, financialYear: year, periodStart: start, periodEnd: end,
                paidOn: paidOn, grossCents: Self.cents(amount(.gross)) ?? 0,
                taxWithheldCents: Self.cents(amount(.taxWithheld)) ?? 0,
                superCents: Self.cents(amount(.super)) ?? 0, netCents: Self.cents(amount(.net)) ?? 0,
                salarySacrificeCents: Self.cents(amount(.salarySacrifice)),
                ytdGrossCents: Self.cents(amount(.ytdGross)),
                ytdTaxWithheldCents: Self.cents(amount(.ytdTaxWithheld)),
                ytdSuperCents: Self.cents(amount(.ytdSuper)), note: trimmed.isEmpty ? nil : trimmed),
            lines: enteredLines.map { line in
                PayslipLineInput(
                    kind: line.kind, sourceInflowId: line.kind == .earning ? line.sourceInflowId : nil,
                    taxComponent: line.kind == .tax ? line.component : nil,
                    label: line.label.trimmingCharacters(in: .whitespaces),
                    amountCents: Self.cents(line.amount) ?? 0)
            },
            attachment: attachment)
    }

    // MARK: Formatting

    /// Whole cents as the dollars text a field holds: two fixed decimals, `""` when unset.
    static func dollars(_ cents: Int?) -> String {
        guard let cents else { return "" }
        return String(format: "%.2f", Double(cents) / 100)
    }

    /// The cents a dollars field holds, rounded half up as the PWA's `dollarsToCents`
    /// does; nil when blank or not a number. A `$` and thousands commas are ignored.
    static func cents(_ text: String) -> Int? {
        let cleaned = text.replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty, let dollars = Double(cleaned), dollars.isFinite else { return nil }
        return Int((dollars * 100 + 0.5).rounded(.down))
    }

    /// Today's local date as `YYYY-MM-DD`.
    static func todayIso(_ date: Date = Date()) -> String { iso(date, timeZone: .current) }

    /// The ISO date `days` before `iso`.
    static func isoDaysBefore(_ iso: String, _ days: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = parse(iso) else { return iso }
        return Self.iso(calendar.date(byAdding: .day, value: -days, to: date) ?? date, timeZone: calendar.timeZone)
    }

    /// An ISO date as a `Date` at midnight UTC.
    static func parse(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func iso(_ date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }
}
