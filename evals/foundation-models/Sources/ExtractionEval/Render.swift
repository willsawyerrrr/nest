import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Lays a document's rows out as a one-page PDF (with a text layer) and a PNG raster of it.
enum Render {
  static let page = CGRect(x: 0, y: 0, width: 595, height: 842)
  static let margin: CGFloat = 40
  static let firstColumn: CGFloat = 200
  /// PNG pixels per PDF point, giving an A4 page at 150 dpi.
  static let scale: CGFloat = 1240 / 595

  static func render(_ doc: CorpusDoc, into dir: URL) throws {
    let files = dir.appending(path: "files")
    try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)

    var box = page
    guard let pdf = CGContext(files.appending(path: "\(doc.id).pdf") as CFURL, mediaBox: &box, nil)
    else { throw EvalError("cannot create PDF for \(doc.id)") }
    pdf.beginPDFPage(nil)
    draw(doc, in: pdf)
    pdf.endPDFPage()
    pdf.closePDF()

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
    draw(doc, in: bitmap)
    guard let image = bitmap.makeImage(),
      let out = CGImageDestinationCreateWithURL(
        files.appending(path: "\(doc.id).png") as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw EvalError("cannot write PNG for \(doc.id)") }
    CGImageDestinationAddImage(out, image, nil)
    guard CGImageDestinationFinalize(out) else { throw EvalError("cannot write PNG for \(doc.id)") }
  }

  private static func draw(_ doc: CorpusDoc, in context: CGContext) {
    let rightCells = max(1, (doc.rows.map(\.count).max() ?? 1) - 1)
    let columnWidth = (page.width - 2 * margin - firstColumn) / CGFloat(rightCells)
    let lineHeight = min(16, (page.height - 2 * margin) / CGFloat(doc.rows.count))
    let fontSize = min(10, lineHeight * 0.7)
    for (index, row) in doc.rows.enumerated() {
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
