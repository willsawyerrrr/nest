import Foundation
import Testing

@testable import ExtractionEval

@Suite struct ImportTests {
  func folder() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  @Test func pickingTheCorpusFolderKeepsItsFiles() throws {
    let root = try folder()
    try "keep".write(to: root.appending(path: "corpus.json"), atomically: true, encoding: .utf8)
    #expect(try CorpusImport.run(from: root, into: root) == .alreadyInPlace)
    #expect(try String(contentsOf: root.appending(path: "corpus.json"), encoding: .utf8) == "keep")
  }

  @Test func replacesExistingFilesAndAddsNewOnes() throws {
    let root = try folder()
    let source = try folder()
    try "old".write(to: root.appending(path: "corpus.json"), atomically: true, encoding: .utf8)
    try "new".write(to: source.appending(path: "corpus.json"), atomically: true, encoding: .utf8)
    try "extra".write(to: source.appending(path: "a.pdf"), atomically: true, encoding: .utf8)
    #expect(try CorpusImport.run(from: source, into: root) == .imported(copied: 2))
    #expect(try String(contentsOf: root.appending(path: "corpus.json"), encoding: .utf8) == "new")
    #expect(try String(contentsOf: root.appending(path: "a.pdf"), encoding: .utf8) == "extra")
    #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).count == 2)
  }

  @Test func aSymlinkedPathToTheCorpusFolderIsAlreadyInPlace() throws {
    let root = try folder()
    let link = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root)
    try "keep".write(to: root.appending(path: "corpus.json"), atomically: true, encoding: .utf8)
    #expect(try CorpusImport.run(from: link, into: root) == .alreadyInPlace)
    #expect(FileManager.default.fileExists(atPath: root.appending(path: "corpus.json").path))
  }
}
