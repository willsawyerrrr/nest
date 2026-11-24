import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Lays a document's rows out as a one-page PDF (with a text layer) and a PNG raster of it, and
/// renders the noisy variants a manifest describes.
enum Render {
  static let page = CGRect(x: 0, y: 0, width: 595, height: 842)
  static let margin: CGFloat = 40
  static let firstColumn: CGFloat = 200
  /// PNG pixels per PDF point, giving an A4 page at 150 dpi.
  static let scale: CGFloat = 1240 / 595

  static func render(_ doc: CorpusDoc, into dir: URL) throws {
    let files = try filesDirectory(in: dir)
    let pdf = files.appending(path: "\(doc.id).pdf")
    switch doc.fault {
    case "imageOnly": try writeImagePDF(try raster(doc), to: pdf, name: doc.id)
    case "corrupt":
      try writeTextPDF(doc, to: pdf)
      let data = try Data(contentsOf: pdf)
      try data.prefix(data.count * 3 / 5).write(to: pdf)
    default: try writeTextPDF(doc, to: pdf, encrypted: doc.fault == "encrypted")
    }
    for page in doc.pages.indices {
      let name = page == 0 ? "\(doc.id).png" : "\(doc.id).p\(page + 1).png"
      try writePNG(try raster(doc, page: page), to: files.appending(path: name), name: doc.id)
    }
  }

  static func filesDirectory(in dir: URL) throws -> URL {
    let files = dir.appending(path: "files")
    try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
    return files
  }

  /// The document as a vector PDF, a page per `doc.pages`, whose text layer holds its rows.
  /// `encrypted` opens only with the password `eval`.
  static func writeTextPDF(_ doc: CorpusDoc, to url: URL, encrypted: Bool = false) throws {
    var box = page
    let info: CFDictionary? =
      encrypted
      ? [kCGPDFContextUserPassword: "eval", kCGPDFContextOwnerPassword: "eval"] as CFDictionary : nil
    guard let pdf = CGContext(url as CFURL, mediaBox: &box, info)
    else { throw EvalError("cannot create PDF for \(doc.id)") }
    for rows in doc.pages {
      pdf.beginPDFPage(nil)
      draw(rows, in: pdf)
      pdf.endPDFPage()
    }
    pdf.closePDF()
  }

  /// A page of the document rasterised on white at `scale` pixels per point.
  static func raster(_ doc: CorpusDoc, page index: Int = 0) throws -> CGImage {
    let size = (width: Int(page.width * scale), height: Int(page.height * scale))
    guard
      let bitmap = CGContext(
        data: nil, width: size.width, height: size.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw EvalError("cannot create bitmap for \(doc.id)") }
    bitmap.setFillColor(CGColor(gray: 1, alpha: 1))
    bitmap.fill(CGRect(x: 0, y: 0, width: size.width, height: size.height))
    bitmap.scaleBy(x: scale, y: scale)
    draw(doc.pages[index], in: bitmap)
    guard let image = bitmap.makeImage() else { throw EvalError("cannot rasterise \(doc.id)") }
    return image
  }

  static func writePNG(_ image: CGImage, to url: URL, name: String) throws {
    guard
      let out = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw EvalError("cannot write PNG for \(name)") }
    CGImageDestinationAddImage(out, image, nil)
    guard CGImageDestinationFinalize(out) else { throw EvalError("cannot write PNG for \(name)") }
  }

  /// A one-page PDF holding only `image`, so it has no text layer.
  static func writeImagePDF(_ image: CGImage, to url: URL, name: String) throws {
    var box = CGRect(x: 0, y: 0, width: CGFloat(image.width) / scale, height: CGFloat(image.height) / scale)
    guard let pdf = CGContext(url as CFURL, mediaBox: &box, nil)
    else { throw EvalError("cannot create PDF for \(name)") }
    pdf.beginPDFPage(nil)
    pdf.draw(image, in: box)
    pdf.endPDFPage()
    pdf.closePDF()
  }

  private static func draw(_ rows: [[String]], in context: CGContext) {
    let rightCells = max(1, (rows.map(\.count).max() ?? 1) - 1)
    let columnWidth = (page.width - 2 * margin - firstColumn) / CGFloat(rightCells)
    let lineHeight = min(16, (page.height - 2 * margin) / CGFloat(max(1, rows.count)))
    let fontSize = min(10, lineHeight * 0.7)
    for (index, row) in rows.enumerated() {
      let y = page.height - margin - CGFloat(index + 1) * lineHeight
      for (column, text) in row.enumerated() where !text.isEmpty {
        let x = column == 0 ? margin : margin + firstColumn + CGFloat(column - 1) * columnWidth
        let bold = index < 2 || row[0] == row[0].uppercased() && column == 0
        let font = CTFontCreateWithName((bold ? "Helvetica-Bold" : "Helvetica") as CFString, fontSize, nil)
        let line = CTLineCreateWithAttributedString(
          NSAttributedString(
            string: text,
            attributes: [
              .font: font,
              NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
            ]))
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.textPosition = CGPoint(x: x, y: y)
        CTLineDraw(line, context)
      }
    }
  }
}

struct EvalError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}
