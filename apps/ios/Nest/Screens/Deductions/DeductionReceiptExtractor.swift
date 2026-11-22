import Foundation

#if canImport(FoundationModels)
    import FoundationModels
#endif

/// Why an on-device receipt read was not accepted. The router sends the document to the
/// server on any of them.
enum ReceiptReadError: Error, Equatable, Sendable {
    /// The text could not be recognised confidently enough to trust a reading.
    case lowConfidence
    /// The prompt does not fit the model's context window.
    case tooLong
    /// The model reported a document that is not a receipt; the server gives that verdict.
    case notReceiptClaimed
    /// The reading is not traceable to the document; `reasons` names each failed check.
    case doubtful(reasons: [String])
    /// The model is not available.
    case modelUnavailable
}

/// Reads a deduction receipt on-device: the text comes from the PDF's text layer or Vision
/// OCR, the system language model reports each field as printed, and `ReceiptReading`
/// converts it as the server does. Only a reading every value of which is found in the
/// document is returned; any doubt throws, leaving the receipt to the server.
struct DeductionReceiptExtractor: OnDeviceExtractor {
    /// OCR below this mean confidence is not trusted.
    static let minimumConfidence = 0.6

    var readText: @Sendable (Data) async throws -> DocumentText.Reading = { try await DocumentText.read($0) }
    var generate: @Sendable (ReceiptPrompt) async throws -> RawReceiptFields = { prompt in
        try await OnDeviceReceiptModel.read(prompt)
    }

    /// The receipt's fields, or a thrown error that leaves the document to the server: the
    /// text could not be read confidently, the prompt does not fit the context window, the
    /// model called it not a receipt, or the reading is not traceable to the document.
    func extract(_ request: OnDeviceRequest) async throws -> DeductionExtraction {
        let text = try await readText(request.data)
        guard text.confidence >= Self.minimumConfidence else { throw ReceiptReadError.lowConfidence }
        let prompt = ReceiptPrompt(
            category: request.category ?? .workExpense, document: text.text)
        let raw = try await generate(prompt)
        guard raw.isReceipt else { throw ReceiptReadError.notReceiptClaimed }
        let doubts = ReceiptCheck.doubts(raw, in: text.text, financialYear: request.financialYear)
        guard doubts.isEmpty else { throw ReceiptReadError.doubtful(reasons: doubts) }
        return raw.reading(financialYear: request.financialYear).extraction
    }
}

/// The system language model's reading of a receipt.
enum OnDeviceReceiptModel {
    /// Asks the system model for the receipt's fields. Throws when it is not ready, the
    /// prompt does not fit its context window (checked up front, and again by the model,
    /// which throws if the count was short), or generation fails.
    static func read(_ prompt: ReceiptPrompt) async throws -> RawReceiptFields {
        #if canImport(FoundationModels)
            if #available(iOS 26, macOS 26, *) {
                let model = SystemLanguageModel.default
                guard case .available = model.availability else { throw ReceiptReadError.modelUnavailable }
                guard prompt.fits(contextSize: model.contextSize) else { throw ReceiptReadError.tooLong }
                let session = LanguageModelSession(model: model, instructions: prompt.instructions)
                let generated = try await session.respond(
                    to: prompt.document, generating: GeneratedReceipt.self,
                    options: GenerationOptions(sampling: .greedy)
                ).content
                return RawReceiptFields(
                    isReceipt: generated.isReceipt, notReceiptReason: generated.notReceiptReason,
                    description: generated.description, deductionDate: generated.deductionDate,
                    amount: generated.amount)
            }
        #endif
        throw ReceiptReadError.modelUnavailable
    }
}

#if canImport(FoundationModels)
    /// The structure the model fills in; every field is nullable so a receipt that does
    /// not show one yields null, not an invention.
    @available(iOS 26, macOS 26, *)
    @Generable
    private struct GeneratedReceipt {
        @Guide(description: "True when the document is the kind of receipt described; false for anything else.")
        var isReceipt: Bool
        @Guide(description: "What the document is, when it is not a receipt. Null otherwise.")
        var notReceiptReason: String?
        @Guide(description: "The name described in the instructions, as printed. Null when the receipt does not show it.")
        var description: String?
        @Guide(description: "The date of purchase exactly as printed. Null when the receipt does not show it.")
        var deductionDate: String?
        @Guide(description: "The total amount paid, as printed. Null when the receipt does not show it.")
        var amount: String?
    }
#endif
