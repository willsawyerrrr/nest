import Foundation
import FoundationModels

/// `ExtractionEval facts` prints what the installed SDK and device report.
/// `ExtractionEval render <dir>` writes each corpus document as PDF and PNG under `<dir>/files`,
/// then each variant in `<dir>/manifest.json` (see `supabase/functions/_eval/noise.ts`).
/// `ExtractionEval run <dir> pdftext|ocr|image|image-hires|ocr+image [--model system|pcc]
/// [--sampling default|greedy] [--repeats n] [--only id,id]` writes
/// `<dir>/results/fm-<model>-<path>[-greedy].json`.
func usage() -> Never {
  FileHandle.standardError.write(Data("usage: ExtractionEval facts | render <dir> | run <dir> <path> [--model m] [--sampling default|greedy] [--repeats n] [--only ids]\n".utf8))
  exit(2)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { usage() }

switch command {
case "facts":
  await Facts.print()
case "render":
  guard args.count == 2 else { usage() }
  let dir = URL(filePath: args[1])
  let docs = try CorpusDoc.load(from: dir)
  for doc in docs { try Render.render(doc, into: dir) }
  if let manifest = try Manifest.load(from: dir) {
    for variant in manifest.variants { try Noise.render(variant, of: docs, into: dir) }
  }
case "run":
  guard args.count >= 3, let path = InputPath(rawValue: args[2]) else { usage() }
  var model = ModelChoice.system
  var sampling = Sampling.default
  var repeats = 1
  var only = Set<String>()
  var index = 3
  while index + 1 < args.count {
    switch args[index] {
    case "--model":
      guard let choice = ModelChoice(rawValue: args[index + 1]) else { usage() }
      model = choice
    case "--sampling":
      guard let choice = Sampling(rawValue: args[index + 1]) else { usage() }
      sampling = choice
    case "--repeats":
      guard let count = Int(args[index + 1]), count > 0 else { usage() }
      repeats = count
    case "--only": only = Set(args[index + 1].split(separator: ",").map(String.init))
    default: usage()
    }
    index += 2
  }
  try await Run.run(dir: URL(filePath: args[1]), path: path, model: model, sampling: sampling, repeats: repeats, only: only)
default:
  usage()
}
