import Foundation
import Testing

@testable import ExtractionEval

@Suite struct PagesTests {
  let doc = try! JSONDecoder().decode(
    CorpusDoc.self,
    from: Data(
      #"{"id": "d", "kind": "payslip", "financialYear": 2026, "rows": [["Gross", "$2.00"], ["Super", "$0.20"]], "pageBreaks": [1]}"#
        .utf8))

  func rendered() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try Render.render(doc, into: dir)
    return dir.appending(path: "files")
  }

  @Test func everyRenderedPageIsListedInOrder() throws {
    let files = try rendered()
    #expect(Pages.images(of: "d", in: files).map(\.lastPathComponent) == ["d.png", "d.p2.png"])
  }

  @Test func aVariantHasOnePage() throws {
    let files = try rendered()
    try FileManager.default.removeItem(at: files.appending(path: "d.p2.png"))
    #expect(Pages.images(of: "d", in: files).map(\.lastPathComponent) == ["d.png"])
  }

  @Test func bandsCoverEveryPage() throws {
    let files = try rendered()
    #expect(try Tiles.bands(ofPages: Pages.images(of: "d", in: files)).count == 2 * Tiles.count)
  }

  @Test func aReadablePdfIsNotUnreadable() throws {
    #expect(Pages.unreadable(try rendered().appending(path: "d.pdf")) == nil)
  }

  @Test func aMissingPdfIsNotUnreadable() throws {
    #expect(Pages.unreadable(try rendered().appending(path: "none.pdf")) == nil)
  }

  @Test func aTruncatedPdfIsCorrupt() throws {
    let pdf = try rendered().appending(path: "d.pdf")
    let data = try Data(contentsOf: pdf)
    try data.prefix(data.count * 3 / 5).write(to: pdf)
    #expect(Pages.unreadable(pdf) == "corrupt")
  }

  @Test func aPasswordProtectedPdfIsEncrypted() throws {
    let pdf = try rendered().appending(path: "d.pdf")
    try Render.writeTextPDF(doc, to: pdf, encrypted: true)
    #expect(Pages.unreadable(pdf) == "encrypted")
  }

  @Test func aPromptFillingTheContextOverflows() {
    #expect(Pages.overflow(tokens: 4097, contextSize: 4096) == "context_exceeded(4097/4096)")
    #expect(Pages.overflow(tokens: 4096, contextSize: 4096) == nil)
  }

  @Test func anUnreadableRunIsRecordedWithoutAnAnswer() {
    var result = RunResult(ms: 3)
    result.unreadable = "corrupt"
    let json = result.json
    #expect(json["unreadable"] as? String == "corrupt")
    #expect(json["raw"] == nil && json["error"] == nil)
  }
}
