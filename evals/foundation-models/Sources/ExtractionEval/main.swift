import Foundation
import FoundationModels

/// `ExtractionEval facts` prints what the installed SDK and device report.
/// `ExtractionEval render <dir>` writes each corpus document as PDF and PNG under `<dir>/files`.
/// `ExtractionEval run <dir> pdftext|ocr|image [--model system|pcc] [--only id,id]` writes
/// `<dir>/results/fm-<model>-<path>.json`.
func usage() -> Never {
  FileHandle.standardError.write(Data("usage: ExtractionEval facts | render <dir> | run <dir> <path> [--model m] [--only ids]\n".utf8))
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
  for doc in try CorpusDoc.load(from: dir) { try Render.render(doc, into: dir) }
case "run":
  guard args.count >= 3, let path = InputPath(rawValue: args[2]) else { usage() }
  var model = ModelChoice.system
  var only = Set<String>()
  var index = 3
  while index + 1 < args.count {
    switch args[index] {
    case "--model":
      guard let choice = ModelChoice(rawValue: args[index + 1]) else { usage() }
      model = choice
    case "--only": only = Set(args[index + 1].split(separator: ",").map(String.init))
    default: usage()
    }
    index += 2
  }
  try await Run.run(dir: URL(filePath: args[1]), path: path, model: model, only: only)
default:
  usage()
}
