import Foundation
import Testing

@testable import Nest

/// Runs the eval corpus's synthetic receipts and non-receipts (`deduction-corpus-parity.json`,
/// frozen from `supabase/functions/_eval/corpus.ts` and checked against it by
/// `fields_parity_test.ts`) through the on-device pipeline with the model replaced by what an
/// ideal extractor reports. A receipt must pre-fill what the server path pre-fills; anything
/// else must be refused so it goes to the server.
@Suite struct ReceiptCorpusParityTests {
    struct Document: Decodable, Sendable {
        struct Label: Decodable, Sendable {
            var description: String?
            var deductionDate: String?
            var amount: String?
        }
        var id: String
        var financialYear: Int
        var text: String
        var label: Label?
        var expected: Label?
    }

    private final class BundleLocator {}

    private static let corpus: [Document] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "deduction-corpus-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Document].self, from: Data(contentsOf: url))
    }()

    private func extractor(_ document: Document, model: RawReceiptFields) -> DeductionReceiptExtractor {
        DeductionReceiptExtractor(
            readText: { _ in .init(text: document.text, confidence: 1) }, generate: { _ in model })
    }

    private func request(_ document: Document) -> OnDeviceRequest {
        OnDeviceRequest(
            name: "\(document.id).pdf", data: Data(), financialYear: document.financialYear,
            category: .workExpense)
    }

    /// `2026-05-03` as an Australian receipt prints it.
    private func printed(_ iso: String) -> String {
        let parts = iso.split(separator: "-")
        return "\(parts[2])/\(parts[1])/\(parts[0])"
    }

    @Test func receiptsPrefillWhatTheServerPrefills() async throws {
        let receipts = Self.corpus.filter { $0.label != nil }
        #expect(receipts.count == 5)
        for document in receipts {
            let label = document.label!, expected = document.expected!
            for date in [label.deductionDate!, printed(label.deductionDate!)] {
                let raw = RawReceiptFields(
                    isReceipt: true, description: label.description, deductionDate: date,
                    amount: label.amount)
                let result = try await extractor(document, model: raw).extract(request(document))
                #expect(
                    result
                        == DeductionExtraction(
                            description: expected.description, deductionDate: expected.deductionDate,
                            amountCents: PrintedText.parseCents(label.amount)),
                    "\(document.id) \(date)")
            }
        }
    }

    @Test func aWrongFigureIsRefused() async {
        let document = Self.corpus.first { $0.label != nil }!
        let raw = RawReceiptFields(
            isReceipt: true, description: document.label?.description,
            deductionDate: document.label?.deductionDate, amount: "$999.99")
        await #expect(throws: ReceiptReadError.doubtful(reasons: ["amount is not in the document"])) {
            try await extractor(document, model: raw).extract(request(document))
        }
    }

    @Test func documentsThatAreNotReceiptsAreRefusedEvenWhenTheModelReadsThemAsOne() async {
        let others = Self.corpus.filter { $0.label == nil }
        #expect(others.count == 2)
        for document in others {
            let first = document.text.split(separator: "\n").first.map(String.init)
            let raw = RawReceiptFields(isReceipt: true, description: first, amount: "$1.12")
            await #expect(throws: ReceiptReadError.self, "\(document.id)") {
                try await extractor(document, model: raw).extract(request(document))
            }
        }
    }
}
