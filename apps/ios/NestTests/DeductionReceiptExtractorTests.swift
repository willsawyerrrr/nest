import CoreGraphics
import CoreText
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import Nest

/// The extraction pipeline around the model, with the model replaced by a stub; synthetic
/// receipts only. The live system model is not exercised here.
@Suite struct DeductionReceiptExtractorTests {
    private struct Boom: Error {}

    private func request(category: DeductionCategory? = .workExpense) -> OnDeviceRequest {
        OnDeviceRequest(name: "r.pdf", data: Data(), financialYear: 2026, category: category)
    }

    private func extractor(
        text: String = ReceiptCheckTests.receipt, confidence: Double = 1,
        model: RawReceiptFields
    ) -> DeductionReceiptExtractor {
        DeductionReceiptExtractor(
            readText: { _ in .init(text: text, confidence: confidence) }, generate: { _ in model })
    }

    private let good = RawReceiptFields(
        isReceipt: true, description: "Officeworks", deductionDate: "06/07/2025", amount: "$1,124.50")

    @Test func aGroundedReadingIsReturned() async throws {
        let result = try await extractor(model: good).extract(request())
        #expect(
            result
                == DeductionExtraction(
                    description: "Officeworks", deductionDate: "2025-07-06", amountCents: 112450))
    }

    @Test func aFieldTheModelLeftNullStaysBlank() async throws {
        let raw = RawReceiptFields(isReceipt: true, amount: "$1,124.50")
        let result = try await extractor(model: raw).extract(request())
        #expect(result == DeductionExtraction(amountCents: 112450))
    }

    @Test func aReadingNotInTheDocumentIsRefused() async {
        var raw = good
        raw.amount = "$1,142.50"
        await #expect(throws: ReceiptReadError.doubtful(reasons: ["amount is not in the document"])) {
            try await extractor(model: raw).extract(request())
        }
    }

    @Test func lowConfidenceTextIsRefusedBeforeTheModelRuns() async {
        let neverRuns = DeductionReceiptExtractor(
            readText: { _ in .init(text: "x", confidence: 0.2) },
            generate: { _ in Issue.record("model ran"); return RawReceiptFields(isReceipt: true) })
        await #expect(throws: ReceiptReadError.lowConfidence) { try await neverRuns.extract(request()) }
    }

    @Test func aNotReceiptClaimIsLeftToTheServer() async {
        let raw = RawReceiptFields(isReceipt: false, notReceiptReason: "A boarding pass")
        await #expect(throws: ReceiptReadError.notReceiptClaimed) {
            try await extractor(model: raw).extract(request())
        }
    }

    @Test func aModelFailureIsPropagated() async {
        let failing = DeductionReceiptExtractor(
            readText: { _ in .init(text: ReceiptCheckTests.receipt, confidence: 1) },
            generate: { _ in throw Boom() })
        await #expect(throws: Boom.self) { try await failing.extract(request()) }
    }

    @Test func theRouterFallsBackToTheServerOnAnyRefusal() async {
        let router = OnDeviceExtraction<DeductionExtraction>(
            extractors: [extractor(model: RawReceiptFields(isReceipt: true))], isModelReady: { true })
        let result = await router.read(path: "h/r.pdf", financialYear: 2026, category: .workExpense) {
            Data()
        }
        #expect(result == nil)
    }

    @Test func theCategoryShapesThePrompt() {
        let donation = ReceiptPrompt(category: .donation, document: "d")
        #expect(donation.instructions.contains("deductible gift recipient"))
        #expect(donation.instructions.contains("exactly as printed"))
        let fees = ReceiptPrompt(category: .taxAgentFees, document: "d")
        #expect(fees.instructions.contains("tax agent or accountant fees"))
    }

    @Test func aPromptFitsOnlyWithinTheContextWindow() {
        let short = ReceiptPrompt(category: .workExpense, document: "Total 5.00")
        let long = ReceiptPrompt(
            category: .workExpense, document: String(repeating: "x", count: 20_000))
        #expect(short.fits(contextSize: 4096))
        #expect(!long.fits(contextSize: 4096))
        #expect(long.fits(contextSize: 32_768))
    }
}

/// Reads text back out of synthetic documents drawn here.
@Suite struct DocumentTextTests {
    private static let lines = ["OFFICEWORKS", "Tax Invoice", "Total $124.50"]

    private static func draw(_ context: CGContext, height: CGFloat) {
        for (index, line) in lines.enumerated() {
            let attributed = NSAttributedString(
                string: line,
                attributes: [
                    kCTFontAttributeName as NSAttributedString.Key: CTFontCreateWithName(
                        "Helvetica" as CFString, 36, nil)
                ])
            context.textPosition = CGPoint(x: 40, y: height - 80 - CGFloat(index) * 60)
            CTLineDraw(CTLineCreateWithAttributedString(attributed), context)
        }
    }

    static func pdf() -> Data {
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 600, height: 400)
        let context = CGContext(consumer: CGDataConsumer(data: data)!, mediaBox: &box, nil)!
        context.beginPDFPage(nil)
        draw(context, height: 400)
        context.endPDFPage()
        context.closePDF()
        return data as Data
    }

    static func png() -> Data {
        let context = CGContext(
            data: nil, width: 900, height: 500, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 900, height: 500))
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        draw(context, height: 500)
        let data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(
            data, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        CGImageDestinationFinalize(destination)
        return data as Data
    }

    @Test func aPDFsTextLayerIsReadWithoutRecognition() async throws {
        let reading = try await DocumentText.read(Self.pdf())
        #expect(reading.confidence == 1)
        #expect(reading.text.contains("OFFICEWORKS"))
        #expect(reading.text.contains("$124.50"))
    }

    @Test func anImageIsRecognised() async throws {
        let reading = try await DocumentText.read(Self.png())
        #expect(reading.text.uppercased().contains("OFFICEWORKS"))
        #expect(reading.text.contains("124.50"))
    }

    @Test func somethingThatIsNotADocumentIsUnreadable() async {
        await #expect(throws: DocumentTextError.unreadable) {
            try await DocumentText.read(Data("not a document".utf8))
        }
    }
}
