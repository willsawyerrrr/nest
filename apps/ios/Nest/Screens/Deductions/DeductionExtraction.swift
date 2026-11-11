import Foundation

/// A successful receipt read: the values there is something to fill in for. A
/// field the receipt does not show is nil and left blank for the member.
struct DeductionExtraction: Equatable, Sendable {
    var description: String?
    var deductionDate: String?
    var amountCents: Int?

    /// Whether the read gave nothing to fill in.
    var isEmpty: Bool { description == nil && deductionDate == nil && amountCents == nil }
}

/// How an attach-and-read ended. Every outcome but `read` falls back to manual
/// entry with the reason stated; none of them blocks the save.
enum DeductionExtractionOutcome: Equatable, Sendable {
    case read(DeductionExtraction)
    case notConfigured(String)
    case outOfCredit(String)
    case keyRejected(String)
    case notReceipt(message: String, reason: String?)
    case unsupported(String)
    case failed(String)
}

/// The client half of receipt extraction, mirroring the PWA's `deductionExtraction.ts`:
/// reading the `deduction-extract` function's reply, and its failures into states the
/// form shows honestly. Nothing here writes a deduction.
enum DeductionExtractor {
    static let unconfiguredMessage = "Receipt extraction is not configured. Enter the details by hand."
    static let outOfCreditMessage =
        "Receipt reading is off until the Anthropic account is topped up. Nothing is wrong with your file — enter the details by hand."
    static let keyRejectedMessage =
        "Receipt reading is off until the Anthropic API key is fixed. Nothing is wrong with your file — enter the details by hand."
    static let notReceiptMessage = "That file does not look like a receipt."
    static let unsupportedMessage =
        "This file is attached, but it can't be read automatically. Enter the details by hand."
    static let failedMessage = "Could not read this receipt. Enter the details by hand."

    /// Messages the function sends about its own internals rather than the member's file.
    private static let internalMessages: Set<String> = [
        "No household membership for this user", "Could not resolve household",
    ]

    /// Reads a successful reply, or nil when the body is not one.
    static func read(_ data: Data) -> DeductionExtraction? {
        guard
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            body["model"] is String
        else { return nil }
        let fields = body["fields"] as? [String: Any] ?? [:]
        var extraction = DeductionExtraction()
        extraction.description = fields["description"] as? String
        extraction.deductionDate = fields["deduction_date"] as? String
        if let cents = fields["amount_cents"] as? NSNumber, !(cents is Bool), cents.doubleValue >= 0 {
            extraction.amountCents = cents.intValue
        }
        return extraction
    }

    /// Reads a non-2xx body into the state the form shows.
    static func readFailure(_ data: Data?) -> DeductionExtractionOutcome {
        let body = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
        let message = (body?["error"] as? String).flatMap { internalMessages.contains($0) ? nil : $0 }
        if body?["code"] as? String == UploadRules.unsupportedTypeCode {
            return .unsupported(unsupportedMessage)
        }
        if body?["configured"] as? Bool == false {
            return .notConfigured(message ?? unconfiguredMessage)
        }
        if body?["outOfCredit"] as? Bool == true {
            return .outOfCredit(message ?? outOfCreditMessage)
        }
        if body?["keyRejected"] as? Bool == true {
            return .keyRejected(message ?? keyRejectedMessage)
        }
        if body?["notReceipt"] as? Bool == true {
            return .notReceipt(
                message: message ?? notReceiptMessage, reason: body?["reason"] as? String)
        }
        return .failed(message ?? failedMessage)
    }

    /// An outcome in the terms the bulk upload queue acts on. A reading that is off
    /// halts the queue, since every other file would meet the same refusal.
    static func readResult(_ outcome: DeductionExtractionOutcome) -> BulkUpload.ReadResult<DeductionDraft> {
        switch outcome {
        case .read(let extraction): .read(DeductionDraft(extraction: extraction))
        case .unsupported(let message): .unsupported(message: message)
        case .notConfigured(let message), .outOfCredit(let message), .keyRejected(let message):
            .halt(message: message)
        case .notReceipt(let message, let reason):
            .failed(message: reason.map { "\(message) \($0)" } ?? message)
        case .failed(let message): .failed(message: message)
        }
    }
}

/// What the queue holds for one receipt: what was read off it, or nothing for a
/// file entered by hand.
struct DeductionDraft: Equatable, Sendable {
    var extraction: DeductionExtraction?
}
