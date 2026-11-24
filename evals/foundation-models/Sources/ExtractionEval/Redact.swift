import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers
import Vision

/// Paints identifiers out of a real document's raster for arms that leave the machine.
///
/// The terms to paint come from `supabase/functions/_eval/redact.ts` (`redact.ts terms`), which finds
/// names, addresses, TFNs, ABNs and account numbers in the document's text. Each term is located on
/// every page by the PDF's own text layer where there is one and by Vision's text recogniser on
/// the raster, painted over in black, and the result is checked: the painted raster is recognised
/// again and the run fails if any term is still readable. The output has no text layer, so nothing
/// painted over survives in it. Nothing here prints a term or a recognised string.
enum Redact {
  /// Pixels per PDF point when a PDF page is rasterised: 200 dpi.
  static let scale: CGFloat = 200 / 72

  /// Where `terms` occur in `text`, case-insensitively and not inside a longer word.
  static func ranges(of terms: [String], in text: String) -> [Range<String.Index>] {
    var found: [Range<String.Index>] = []
    for term in terms where !term.trimmingCharacters(in: .whitespaces).isEmpty {
      var from = text.startIndex
      while let hit = text.range(of: term, options: [.caseInsensitive], range: from..<text.endIndex) {
        let before = hit.lowerBound > text.startIndex ? text[text.index(before: hit.lowerBound)] : nil
        let after = hit.upperBound < text.endIndex ? text[hit.upperBound] : nil
        let bounded = !(before?.isLetter == true || before?.isNumber == true)
          && !(after?.isLetter == true || after?.isNumber == true)
        if bounded { found.append(hit) }
        from = hit.upperBound
      }
    }
    return found
  }

  /// `image` with each rectangle (in pixels, origin top left) filled black.
  static func paint(_ image: CGImage, over boxes: [CGRect]) throws -> CGImage {
    guard
      let context = CGContext(
        data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw EvalError("cannot create bitmap") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    context.setFillColor(CGColor(gray: 0, alpha: 1))
    for box in boxes {
      // A margin covers glyph edges the recogniser's box trims.
      let padded = box.insetBy(dx: -3, dy: -3)
      context.fill(CGRect(x: padded.minX, y: CGFloat(image.height) - padded.maxY, width: padded.width, height: padded.height))
    }
    guard let painted = context.makeImage() else { throw EvalError("cannot paint") }
    return painted
  }

  /// Boxes (pixels, origin top left) of the recognised text that contains any of `terms`.
  static func recognisedBoxes(of terms: [String], in image: CGImage) async throws -> [CGRect] {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let size = CGSize(width: image.width, height: image.height)
    var boxes: [CGRect] = []
    for observation in try await request.perform(on: image) {
      guard let candidate = observation.topCandidates(1).first else { continue }
      for range in ranges(of: terms, in: candidate.string) {
        guard let box = candidate.boundingBox(for: range) else { continue }
        let rect = box.boundingBox.toImageCoordinates(size, origin: .upperLeft)
        boxes.append(rect)
      }
    }
    return boxes
  }

  /// Whether any of `terms` is still readable in `image`.
  static func leaks(_ terms: [String], in image: CGImage) async throws -> Bool {
    try await !recognisedBoxes(of: terms, in: image).isEmpty
  }

  /// The pages of a PDF as rasters, with the text-layer boxes of `terms` on each (pixels, top left).
  static func pdfPages(_ url: URL, terms: [String]) throws -> [(CGImage, [CGRect])] {
    guard let document = PDFDocument(url: url) else { throw EvalError("cannot open PDF") }
    let selections = terms.flatMap { document.findString($0, withOptions: [.caseInsensitive]) }
    return try (0..<document.pageCount).map { index in
      guard let page = document.page(at: index) else { throw EvalError("cannot read page") }
      let media = page.bounds(for: .mediaBox)
      let width = Int(media.width * scale)
      let height = Int(media.height * scale)
      guard
        let context = CGContext(
          data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { throw EvalError("cannot create bitmap") }
      context.setFillColor(CGColor(gray: 1, alpha: 1))
      context.fill(CGRect(x: 0, y: 0, width: width, height: height))
      context.scaleBy(x: scale, y: scale)
      page.draw(with: .mediaBox, to: context)
      guard let image = context.makeImage() else { throw EvalError("cannot rasterise page") }
      let boxes = selections.flatMap { selection in
        selection.selectionsByLine().compactMap { line -> CGRect? in
          guard line.pages.contains(page) else { return nil }
          let bounds = line.bounds(for: page)
          return CGRect(
            x: (bounds.minX - media.minX) * scale, y: (media.maxY - bounds.maxY) * scale,
            width: bounds.width * scale, height: bounds.height * scale)
        }
      }
      return (image, boxes)
    }
  }

  /// Writes `<name>.png`, `<name>.p<n>.png` and a text-layer-free `<name>.pdf` of the painted pages
  /// into `outDir`. Fails, writing nothing, if a term is still readable. With no terms, the pages
  /// are written as they are.
  static func run(input: URL, terms: [String], outDir: URL, name: String) async throws {
    var pages: [(CGImage, [CGRect])]
    if input.pathExtension.lowercased() == "pdf" {
      pages = try pdfPages(input, terms: terms)
    } else {
      guard
        let source = CGImageSourceCreateWithURL(input as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
      else { throw EvalError("cannot read image") }
      pages = [(image, [])]
    }
    var painted: [CGImage] = []
    for (image, known) in pages {
      let found = terms.isEmpty ? [] : try await recognisedBoxes(of: terms, in: image)
      let out = try paint(image, over: known + found)
      if !terms.isEmpty, try await leaks(terms, in: out) { throw EvalError("an identifier survives redaction") }
      painted.append(out)
    }
    try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    for (index, image) in painted.enumerated() {
      let file = index == 0 ? "\(name).png" : "\(name).p\(index + 1).png"
      try Render.writePNG(image, to: outDir.appending(path: file), name: name)
    }
    try writePDF(painted, to: outDir.appending(path: "\(name).pdf"))
  }

  /// A PDF of one page per image, holding only pictures.
  static func writePDF(_ images: [CGImage], to url: URL) throws {
    var box = CGRect(x: 0, y: 0, width: 1, height: 1)
    guard let pdf = CGContext(url as CFURL, mediaBox: &box, nil) else { throw EvalError("cannot create PDF") }
    for image in images {
      var page = CGRect(x: 0, y: 0, width: CGFloat(image.width) / scale, height: CGFloat(image.height) / scale)
      pdf.beginPDFPage([kCGPDFContextMediaBox as String: Data(bytes: &page, count: MemoryLayout<CGRect>.size)] as CFDictionary)
      pdf.draw(image, in: page)
      pdf.endPDFPage()
    }
    pdf.closePDF()
  }

  /// The text a document gives an extractor before redaction: the PDF's text layer, else recognised text.
  static func text(of url: URL) async throws -> String {
    if url.pathExtension.lowercased() == "pdf", let text = PDFDocument(url: url)?.string, !text.isEmpty {
      return text
    }
    if url.pathExtension.lowercased() == "pdf" {
      return try await pdfPages(url, terms: []).asyncMap { try await ocrText($0.0) }.joined(separator: "\n")
    }
    guard
      let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw EvalError("cannot read image") }
    return try await ocrText(image)
  }

  static func ocrText(_ image: CGImage) async throws -> String {
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    return try await request.perform(on: image).compactMap { $0.topCandidates(1).first?.string }
      .joined(separator: "\n")
  }
}

extension Sequence {
  func asyncMap<T>(_ transform: (Element) async throws -> T) async rethrows -> [T] {
    var out: [T] = []
    for element in self { out.append(try await transform(element)) }
    return out
  }
}
