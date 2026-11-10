import Foundation

/// The `payslip` date columns extraction reads.
enum ExtractedDateField: String, CaseIterable, Sendable {
    case periodStart = "period_start"
    case periodEnd = "period_end"
    case paidOn = "paid_on"
}

/// The `payslip` amount columns extraction reads, in integer cents.
enum ExtractedAmountField: String, CaseIterable, Sendable {
    case gross = "gross_cents"
    case taxWithheld = "tax_withheld_cents"
    case `super` = "super_cents"
    case net = "net_cents"
    case salarySacrifice = "salary_sacrifice_cents"
    case ytdGross = "ytd_gross_cents"
    case ytdTaxWithheld = "ytd_tax_withheld_cents"
    case ytdSuper = "ytd_super_cents"
}

/// One line read off the slip: the label as printed and the printed amount in cents,
/// which is signed (a line may reverse an overpayment). `amountCents` is nil when the
/// printed amount could not be converted, so the line is left out.
struct ExtractedLine: Equatable, Sendable {
    var label: String
    var amountCents: Int?
}

/// A tax line, carrying the component the slip says it pays, or nil when it does not.
struct ExtractedTaxLine: Equatable, Sendable {
    var line: ExtractedLine
    var component: PayslipTaxComponent?
}

/// A successful read, as the form pre-fills from it. A field the slip does not show,
/// or whose printed text could not be converted safely, is absent and left blank for
/// the member. Nothing here writes a payslip figure: the member confirms every value.
struct PayslipExtraction: Equatable, Sendable {
    var model: String
    var dates: [ExtractedDateField: String] = [:]
    var amounts: [ExtractedAmountField: Int] = [:]
    var earnings: [ExtractedLine] = []
    var tax: [ExtractedTaxLine] = []
}

/// How an attach-and-read ended. Every outcome but `read` falls back to manual entry
/// with the reason stated; none of them blocks the save.
enum ExtractionOutcome: Equatable, Sendable {
    case read(PayslipExtraction)
    case notConfigured(message: String)
    case outOfCredit(message: String)
    case keyRejected(message: String)
    case notPayslip(message: String, reason: String?)
    case unsupported(message: String)
    case failed(message: String)
}

/// The client half of payslip extraction, mirroring the PWA's `payslipExtraction.ts`:
/// the reading of the `payslip-extract` reply and of its failures, and the attribution
/// of an itemised earnings line to the inflow its printed label names.
enum PayslipExtractionReader {
    static let unconfiguredMessage = "Payslip extraction is not configured. Enter the figures by hand."
    static let outOfCreditMessage =
        "Payslip reading is off until the Anthropic account is topped up. Nothing is wrong with your file — enter the figures by hand."
    static let keyRejectedMessage =
        "Payslip reading is off until the Anthropic API key is fixed. Nothing is wrong with your file — enter the figures by hand."
    static let notPayslipMessage = "That file does not look like a payslip."
    static let unsupportedMessage =
        "This file is attached, but it can't be read automatically. Enter the figures by hand."
    static let failedMessage = "Could not read this payslip. Enter the figures by hand."

    /// Messages the function sends about its own internals rather than about the file.
    private static let internalMessages: Set<String> = [
        "No household membership for this user", "Could not resolve household",
    ]

    /// Reads a successful reply, or nil when the body is not one. A negative total is
    /// dropped (the column checks forbid it, and the sign is not guessed); a negative
    /// line amount is kept as read.
    static func readExtraction(_ data: Data) -> PayslipExtraction? {
        guard let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let model = body["model"] as? String
        else { return nil }
        let raw = body["fields"] as? [String: Any] ?? [:]
        var extraction = PayslipExtraction(model: model)
        for field in ExtractedDateField.allCases {
            if let value = raw[field.rawValue] as? String { extraction.dates[field] = value }
        }
        for field in ExtractedAmountField.allCases {
            if let number = number(raw[field.rawValue]), number >= 0 {
                extraction.amounts[field] = Int(number)
            }
        }
        let lines = body["lines"] as? [String: Any] ?? [:]
        extraction.earnings = readLines(lines["earnings"]).map(\.line)
        extraction.tax = readLines(lines["tax"]).map { line in
            let component = (line.raw["component"] as? String).flatMap(PayslipTaxComponent.init)
            return ExtractedTaxLine(line: line.line, component: component)
        }
        return extraction
    }

    /// Reads a non-2xx body into the state the form shows. The function's own message
    /// is preferred where it sent one; a plain fallback stands in otherwise.
    static func readFailure(_ data: Data?) -> ExtractionOutcome {
        let detail = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
        let message = (detail?["error"] as? String).flatMap {
            internalMessages.contains($0) ? nil : $0
        }
        if detail?["code"] as? String == UploadRules.unsupportedTypeCode {
            return .unsupported(message: unsupportedMessage)
        }
        if detail?["configured"] as? Bool == false {
            return .notConfigured(message: message ?? unconfiguredMessage)
        }
        if detail?["outOfCredit"] as? Bool == true {
            return .outOfCredit(message: message ?? outOfCreditMessage)
        }
        if detail?["keyRejected"] as? Bool == true {
            return .keyRejected(message: message ?? keyRejectedMessage)
        }
        if detail?["notPayslip"] as? Bool == true {
            return .notPayslip(
                message: message ?? notPayslipMessage, reason: detail?["reason"] as? String)
        }
        return .failed(message: message ?? failedMessage)
    }

    /// An outcome in the terms the bulk queue acts on. A reading that is off halts
    /// the queue, since every other file would meet the same refusal.
    static func readResult(_ outcome: ExtractionOutcome) -> BulkUpload.ReadResult<PayslipRead> {
        switch outcome {
        case .read(let extraction): .read(PayslipRead(extraction: extraction))
        case .unsupported(let message): .unsupported(message: message)
        case .notConfigured(let message), .outOfCredit(let message), .keyRejected(let message):
            .halt(message: message)
        case .notPayslip(let message, let reason):
            .failed(message: reason.map { "\(message) \($0)" } ?? message)
        case .failed(let message): .failed(message: message)
        }
    }

    /// The inflow an earnings line's printed label names, or nil when nothing names it
    /// exactly once: the whole label must equal one inflow's whole name, ignoring case
    /// and whitespace. A partial or fuzzy match is never taken.
    static func matchInflow(label: String, options: [InflowOption]) -> String? {
        let wanted = normalised(label)
        guard !wanted.isEmpty else { return nil }
        let matched = options.filter { normalised($0.label) == wanted }
        return matched.count == 1 ? matched[0].value : nil
    }

    private static func normalised(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            return nil
        }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }

    private struct RawLine {
        let line: ExtractedLine
        let raw: [String: Any]
    }

    /// Reads a section's lines, dropping anything that is not a usable line: a line
    /// needs a label, and an amount that is not an integer leaves `amountCents` nil.
    private static func readLines(_ raw: Any?) -> [RawLine] {
        guard let items = raw as? [Any] else { return [] }
        return items.compactMap { item in
            guard let object = item as? [String: Any], let label = object["label"] as? String,
                !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return nil }
            let cents = number(object["amount_cents"]).flatMap { $0 == $0.rounded() ? Int($0) : nil }
            return RawLine(line: ExtractedLine(label: label, amountCents: cents), raw: object)
        }
    }
}

/// An option per inflow an earnings line may draw on.
struct InflowOption: Equatable, Hashable, Sendable {
    let value: String
    let label: String
}

/// What a bulk read hands a draft: the extraction, or nothing for a blank draft.
struct PayslipRead: Equatable, Sendable {
    var extraction: PayslipExtraction?
}
