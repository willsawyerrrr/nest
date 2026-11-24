import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Testing

@testable import ExtractionEval

@Suite struct RedactTests {
  let corpus = """
    [{"id": "s", "kind": "payslip", "financialYear": 2026,
      "rows": [["Example Payroll"], ["Employee", "Jordan Example"], ["TFN", "123 456 782"],
               ["Gross pay", "$5,000.00"], ["Paid", "14/07/2026"]]}]
    """
  let terms = ["Jordan Example", "123 456 782"]

  func render() throws -> (dir: URL, files: URL) {
    let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try corpus.write(to: dir.appending(path: "corpus.json"), atomically: true, encoding: .utf8)
    for doc in try CorpusDoc.load(from: dir) { try Render.render(doc, into: dir) }
    return (dir, dir.appending(path: "files"))
  }

  func image(_ url: URL) throws -> CGImage {
    let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil))
    return try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
  }

  @Test func rangesMatchWholeWordsCaselessly() {
    let text = "jordan example paid; Jordanian example 123 456 7821"
    let found = Redact.ranges(of: terms, in: text).map { String(text[$0]) }
    #expect(found == ["jordan example"])
  }

  @Test func paintingCoversTheBox() async throws {
    let (_, files) = try render()
    let page = try image(files.appending(path: "s.png"))
    let painted = try Redact.paint(page, over: [CGRect(x: 0, y: 0, width: page.width, height: page.height)])
    #expect(try await Redact.ocrText(painted).isEmpty)
  }

  @Test func aTextPDFLosesItsIdentifiersAndKeepsItsFigures() async throws {
    let (dir, files) = try render()
    let out = dir.appending(path: "redacted")
    try await Redact.run(input: files.appending(path: "s.pdf"), terms: terms, outDir: out, name: "s")
    let text = try await Redact.text(of: out.appending(path: "s.pdf"))
    #expect(!text.localizedCaseInsensitiveContains("Jordan"))
    #expect(!text.contains("123 456 782"))
    #expect(text.contains("5,000.00"))
    #expect(text.contains("14/07/2026"))
    #expect((PDFDocument(url: out.appending(path: "s.pdf"))?.string ?? "").isEmpty)
  }

  @Test func aScannedImageLosesItsIdentifiers() async throws {
    let (dir, files) = try render()
    let out = dir.appending(path: "redacted")
    try await Redact.run(input: files.appending(path: "s.png"), terms: terms, outDir: out, name: "s")
    let text = try await Redact.ocrText(try image(out.appending(path: "s.png")))
    #expect(!text.localizedCaseInsensitiveContains("Jordan"))
    #expect(text.contains("5,000.00"))
  }

  @Test func aTermNotOnThePageStillWritesThePaintedPages() async throws {
    let (dir, files) = try render()
    let out = dir.appending(path: "redacted")
    try await Redact.run(input: files.appending(path: "s.png"), terms: ["Not On The Page"], outDir: out, name: "s")
    #expect(FileManager.default.fileExists(atPath: out.appending(path: "s.png").path))
  }
}
