import Foundation
import PDFKit
import Vision

/// Turns a rendered document into the text a text-only model reads.
enum DocumentText {
  /// The PDF's own text layer, as an app reads a text PDF with PDFKit.
  static func pdfText(_ url: URL) throws -> String {
    guard let text = PDFDocument(url: url)?.string, !text.isEmpty else {
      throw EvalError("no text layer in \(url.lastPathComponent)")
    }
    return text
  }

  /// Vision's document recogniser run over an image, as an app reads a photo or scan.
  static func ocr(_ url: URL) async throws -> String {
    let observations = try await RecognizeDocumentsRequest().perform(on: url)
    return observations.map(\.document.text.transcript).joined(separator: "\n")
  }

  /// The transcripts of every page, in page order.
  static func ocr(pages urls: [URL]) async throws -> String {
    var transcripts: [String] = []
    for url in urls { transcripts.append(try await ocr(url)) }
    return transcripts.joined(separator: "\n")
  }
}
