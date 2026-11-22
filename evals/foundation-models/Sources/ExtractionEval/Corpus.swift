import Foundation

/// A corpus document as `supabase/functions/_eval/corpus.ts` writes it; labels are ignored here.
struct CorpusDoc: Decodable {
  let id: String
  let kind: String
  let financialYear: Int
  let rows: [[String]]

  static func load(from dir: URL) throws -> [CorpusDoc] {
    let data = try Data(contentsOf: dir.appending(path: "corpus.json"))
    return try JSONDecoder().decode([CorpusDoc].self, from: data)
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
