import Foundation

/// What the on-device model is asked, following `deduction-extract/model.ts`: the amount
/// and date are reported as the literal printed text, a field the receipt does not show is
/// null, and `ReceiptReading` does the conversion.
struct ReceiptPrompt: Equatable, Sendable {
    var instructions: String
    /// The text read off the document.
    var document: String

    /// Tokens kept free for the response schema and the answer.
    private static let reservedTokens = 600

    /// Characters per token assumed when sizing a prompt; low, so a long document is
    /// caught rather than sent.
    private static let charactersPerToken = 2.5

    init(category: DeductionCategory, document: String) {
        let kind = Self.kind(category)
        instructions = [
            "You read receipts for tax-deductible expenses and report the figures printed",
            "on them, for a person to confirm before saving. You are given the text",
            "recognised from the document; you never save anything yourself.",
            "",
            "Report the amount as the literal text printed on the receipt, character for",
            "character, including its thousands separators, decimal point, and any",
            "currency sign — never a number you have computed, converted, rounded, or",
            "reformatted. Report the TOTAL amount paid, never a subtotal, a GST or other",
            "tax line, or a single line item where the receipt lists several.",
            "",
            kind.descriptionGuidance,
            "",
            "Report the date exactly as printed (for example 06/07/2025 or 6 Jul 2025),",
            "never converted. Where a receipt prints more than one date, report the date",
            "of purchase or transaction, never a statement or due date.",
            "",
            "If the receipt does not show a field, report null for it: a null is filled",
            "in by hand, while a guess becomes a wrong deduction nobody notices. Never",
            "derive a figure by adding, subtracting, or estimating from others, and never",
            "carry a figure over from a similar receipt you have seen.",
            "",
            "If the document is not \(kind.documentKind), set isReceipt to",
            "false, say why in notReceiptReason, and report null for every field.",
        ].joined(separator: "\n")
        self.document = document
    }

    /// Whether the prompt, with room for the answer, fits a model's context window.
    func fits(contextSize: Int) -> Bool {
        let characters = Double(instructions.count + document.count)
        return Int((characters / Self.charactersPerToken).rounded(.up)) + Self.reservedTokens
            <= contextSize
    }

    private static func kind(_ category: DeductionCategory) -> (documentKind: String, descriptionGuidance: String) {
        switch category {
        case .workExpense:
            (
                "a receipt or invoice for a purchase",
                "Report the description as the merchant or business name printed on the receipt. Where no business name is printed, report what was purchased instead, in a few words."
            )
        case .donation:
            (
                "a donation tax receipt from a deductible gift recipient (DGR)",
                "Report the description as the charity or deductible gift recipient (DGR) name printed on the receipt."
            )
        case .taxAgentFees:
            (
                "an invoice for tax agent or accountant fees",
                "Report the description as the tax agent or accounting firm name printed on the invoice."
            )
        }
    }
}
