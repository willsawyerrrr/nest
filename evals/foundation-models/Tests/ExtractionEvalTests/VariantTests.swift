import Foundation
import Testing

@testable import ExtractionEval

@Suite struct VariantTests {
  let corpus = """
    [{"id": "a", "kind": "deduction", "financialYear": 2026, "rows": [["Total", "$1.00"]]},
     {"id": "b", "kind": "payslip", "financialYear": 2026, "rows": [["Gross", "$2.00"]], "pageBreaks": [1]}]
    """
  let manifest = """
    {"seed": 829, "variants": [
      {"id": "a.scan", "baseId": "a", "profile": "scan", "seed": 1, "textLayer": false,
       "ops": [{"op": "twoUp", "companion": "b"}, {"op": "jpeg", "quality": 40}]},
      {"id": "b.born-digital", "baseId": "b", "profile": "born-digital", "seed": 2, "textLayer": true,
       "ops": [{"op": "jpeg", "quality": 40}]}]}
    """

  func directory(manifest: Bool) throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try corpus.write(to: dir.appending(path: "corpus.json"), atomically: true, encoding: .utf8)
    if manifest {
      try self.manifest.write(to: dir.appending(path: "manifest.json"), atomically: true, encoding: .utf8)
    }
    return dir
  }

  @Test func variantsFollowTheCorpusUnderTheirOwnIds() throws {
    let docs = try CorpusDoc.loadAll(from: try directory(manifest: true))
    #expect(docs.map(\.id) == ["a", "b", "a.scan", "b.born-digital"])
    let scan = docs[2]
    #expect(scan.kind == "deduction")
    #expect(scan.rows == docs[0].rows)
    #expect(scan.profile == "scan")
    #expect(scan.textLayer == false)
    #expect(scan.companion == "b")
    #expect(docs[3].pages.count == 2)
    #expect(docs[3].companion == nil)
  }

  @Test func withoutAManifestOnlyTheCorpusLoads() throws {
    let docs = try CorpusDoc.loadAll(from: try directory(manifest: false))
    #expect(docs.map(\.id) == ["a", "b"])
    #expect(docs.allSatisfy { $0.profile == nil && $0.companion == nil })
  }

  @Test func aVariantOfAnUnknownDocumentFails() throws {
    let variant = try JSONDecoder().decode(
      Variant.self,
      from: Data(#"{"id": "z.scan", "baseId": "z", "profile": "scan", "textLayer": false, "ops": []}"#.utf8))
    #expect(throws: (any Error).self) { try variant.document(of: []) }
  }
}
