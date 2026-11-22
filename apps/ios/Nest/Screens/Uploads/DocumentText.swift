import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Vision

/// Why a document yielded no text to read.
enum DocumentTextError: Error, Equatable, Sendable {
    /// The file is not a PDF or image the system can open, or holds no text.
    case unreadable
    /// The document runs to more pages than a receipt does.
    case tooManyPages
}

/// The text of a stored PDF or image: a PDF's own text layer, else Vision OCR of its
/// rendered pages; an image is always recognised.
enum DocumentText {
    struct Reading: Equatable, Sendable {
        var text: String
        /// Mean recognition confidence, 0 to 1; 1 for a PDF's own text.
        var confidence: Double
    }

    /// The most pages read; a receipt is a page or two.
    static let maxPages = 3

    /// A text layer shorter than this is treated as a scan and recognised instead.
    private static let minimumTextLayer = 20

    /// The long edge, in pixels, a PDF page is rendered at for recognition.
    private static let renderedEdge = 2000.0

    /// Reads the text of `data`, off the calling actor.
    static func read(_ data: Data) async throws -> Reading {
        try await Task.detached(priority: .userInitiated) { try readNow(data) }.value
    }

    private static func readNow(_ data: Data) throws -> Reading {
        if data.starts(with: Data("%PDF".utf8)) { return try readPDF(data) }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { throw DocumentTextError.unreadable }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let orientation = (properties?[kCGImagePropertyOrientation] as? UInt32)
            .flatMap(CGImagePropertyOrientation.init(rawValue:)) ?? .up
        return try recognise([(image, orientation)])
    }

    private static func readPDF(_ data: Data) throws -> Reading {
        guard let document = PDFDocument(data: data), !document.isLocked, document.pageCount > 0
        else { throw DocumentTextError.unreadable }
        guard document.pageCount <= maxPages else { throw DocumentTextError.tooManyPages }
        let pages = (0..<document.pageCount).compactMap { document.page(at: $0) }
        let layer = pages.compactMap(\.string).joined(separator: "\n")
        if layer.trimmingCharacters(in: .whitespacesAndNewlines).count >= minimumTextLayer {
            return Reading(text: layer, confidence: 1)
        }
        let images = try pages.map { (try render($0), CGImagePropertyOrientation.up) }
        return try recognise(images)
    }

    private static func render(_ page: PDFPage) throws -> CGImage {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { throw DocumentTextError.unreadable }
        let scale = renderedEdge / max(bounds.width, bounds.height)
        let width = Int(bounds.width * scale), height = Int(bounds.height * scale)
        guard
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { throw DocumentTextError.unreadable }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: context)
        guard let image = context.makeImage() else { throw DocumentTextError.unreadable }
        return image
    }

    private static func recognise(_ images: [(CGImage, CGImagePropertyOrientation)]) throws -> Reading {
        var lines: [String] = []
        var confidences: [Float] = []
        for (image, orientation) in images {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
            for candidate in (request.results ?? []).compactMap({ $0.topCandidates(1).first }) {
                lines.append(candidate.string)
                confidences.append(candidate.confidence)
            }
        }
        guard !lines.isEmpty else { throw DocumentTextError.unreadable }
        let mean = Double(confidences.reduce(0, +)) / Double(confidences.count)
        return Reading(text: lines.joined(separator: "\n"), confidence: mean)
    }
}
