import Foundation

/// A corpus document as `supabase/functions/_eval/corpus.ts` writes it; labels are ignored here.
struct CorpusDoc: Decodable {
  let id: String
  let kind: String
  let financialYear: Int
  let rows: [[String]]
  /// Row indices where a new page starts; absent for a one-page document.
  let pageBreaks: [Int]?
  /// How the file is spoiled instead of rendered normally: `imageOnly` (no text layer), `corrupt`
  /// (truncated PDF) or `encrypted` (password-protected PDF).
  let fault: String?
  /// The noise profile; a noisy variant only.
  var profile: String?
  /// False when the variant's PDF is only a picture, with no text to read; a noisy variant only.
  var textLayer: Bool?
  /// The document sharing a two-up page; a noisy variant only.
  var companion: String?

  /// The rows of each page; one empty page for a document with no rows.
  var pages: [[[String]]] {
    let starts = [0] + (pageBreaks ?? [])
    return starts.enumerated().map { index, start in
      Array(rows[start..<(index + 1 < starts.count ? starts[index + 1] : rows.count)])
    }
  }

  /// `corpus.json`, then `strata.json` (`corpus.ts <dir> --strata`) when it is there.
  static func load(from dir: URL) throws -> [CorpusDoc] {
    var docs: [CorpusDoc] = []
    for name in ["corpus.json", "strata.json"] {
      let url = dir.appending(path: name)
      guard name == "corpus.json" || FileManager.default.fileExists(atPath: url.path) else { continue }
      docs += try JSONDecoder().decode([CorpusDoc].self, from: try Data(contentsOf: url))
    }
    return docs
  }

  /// The corpus and strata documents, then each variant of `manifest.json` when it is there.
  /// A variant is named by its own id, which names its rendered files and results, and carries its
  /// source document's rows; the scorer reads the label from the source document.
  static func loadAll(from dir: URL) throws -> [CorpusDoc] {
    let docs = try load(from: dir)
    guard let manifest = try Manifest.load(from: dir) else { return docs }
    return try docs + manifest.variants.map { try $0.document(of: docs) }
  }
}

/// What an engine produced for one document under one extractor, as the scorer's `RunResult` reads it.
struct RunResult {
  var raw: Any?
  var error: String?
  var ms: Int
  var promptTokens: Int?

  var json: [String: Any] {
    var out: [String: Any] = ["ms": ms]
    if let raw { out["raw"] = raw }
    if let error { out["error"] = error }
    if let promptTokens { out["promptTokens"] = promptTokens }
    return out
  }
}
