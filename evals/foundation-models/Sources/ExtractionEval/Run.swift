import CoreGraphics
import Foundation
import FoundationModels

/// Which input the model is given.
enum InputPath: String {
  /// The PDF's text layer via PDFKit.
  case pdftext
  /// Vision document OCR over the rendered PNG.
  case ocr
  /// The rendered PNG as an iOS 27 image attachment.
  case image
}

/// Which model answers.
enum ModelChoice: String {
  case system
  case pcc
}

enum Run {
  static func run(dir: URL, path: InputPath, model: ModelChoice, only: Set<String>) async throws {
    let corpus = try CorpusDoc.load(from: dir)
    var results: [String: RunResult] = [:]
    for doc in corpus where only.isEmpty || only.contains(doc.id) {
      let kinds = doc.kind == "other" ? ["payslip", "deduction", "trade"] : [doc.kind]
      for kind in kinds {
        let started = ContinuousClock.now
        var result = RunResult(ms: 0)
        do {
          let (raw, tokens) = try await extract(doc, kind: kind, path: path, model: model, dir: dir)
          result.raw = raw
          result.promptTokens = tokens
        } catch {
          result.error = describe(error)
        }
        let elapsed = ContinuousClock.now - started
        result.ms = Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
        results["\(doc.id):\(kind)"] = result
        print("\(doc.id):\(kind)", result.error ?? "ok", "\(result.ms)ms", result.promptTokens.map { "\($0) tokens" } ?? "")
      }
    }
    let engine = "fm-\(model.rawValue)-\(path.rawValue)"
    let out = dir.appending(path: "results")
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let payload = try JSONSerialization.data(
      withJSONObject: [
        "engine": engine,
        "results": results.mapValues(\.json),
      ], options: [.prettyPrinted, .sortedKeys])
    try payload.write(to: out.appending(path: "\(engine).json"))
  }

  /// One document through one extractor: returns the raw fields as JSON and the prompt's token count.
  private static func extract(
    _ doc: CorpusDoc, kind: String, path: InputPath, model: ModelChoice, dir: URL
  ) async throws -> (Any, Int?) {
    let files = dir.appending(path: "files")
    let ask = Instructions.ask(for: kind)
    let prompt: Prompt
    switch path {
    case .pdftext:
      prompt = Prompt("\(ask)\n\nDocument text:\n\(try DocumentText.pdfText(files.appending(path: "\(doc.id).pdf")))")
    case .ocr:
      prompt = Prompt("\(ask)\n\nDocument text:\n\(try await DocumentText.ocr(files.appending(path: "\(doc.id).png")))")
    case .image:
      prompt = Prompt {
        ask
        Attachment(imageURL: files.appending(path: "\(doc.id).png"))
      }
    }
    let instructions = Instructions.text(for: kind, financialYear: doc.financialYear)
    switch model {
    case .system:
      return try await generate(kind, SystemLanguageModel.default, instructions, prompt)
    case .pcc:
      return try await generate(kind, PrivateCloudComputeLanguageModel(), instructions, prompt)
    }
  }

  private static func generate(
    _ kind: String, _ model: some LanguageModel, _ instructions: String, _ prompt: Prompt
  ) async throws -> (Any, Int?) {
    let session = LanguageModelSession(model: model, instructions: instructions)
    let tokens = try? await tokenCount(model, kind, instructions, prompt)
    switch kind {
    case "payslip":
      return (try await JSONEncoder.snake.jsonObject(session.respond(to: prompt, generating: PayslipFields.self).content), tokens)
    case "deduction":
      return (try await JSONEncoder.snake.jsonObject(session.respond(to: prompt, generating: ReceiptFields.self).content), tokens)
    default:
      return (try await JSONEncoder.snake.jsonObject(session.respond(to: prompt, generating: TradeFields.self).content), tokens)
    }
  }

  /// Instructions, schema and prompt, the parts that count against the context before the answer.
  private static func tokenCount(
    _ model: some LanguageModel, _ kind: String, _ instructions: String, _ prompt: Prompt
  ) async throws -> Int {
    guard let system = model as? SystemLanguageModel else { return 0 }
    let schema =
      switch kind {
      case "payslip": PayslipFields.generationSchema
      case "deduction": ReceiptFields.generationSchema
      default: TradeFields.generationSchema
      }
    return try await system.tokenCount(for: prompt)
      + system.tokenCount(for: FoundationModels.Instructions(instructions))
      + system.tokenCount(for: schema)
  }

  private static func describe(_ error: Error) -> String {
    if let error = error as? LanguageModelError, case .contextSizeExceeded(let detail) = error {
      return "context_exceeded(\(detail.tokenCount)/\(detail.contextSize))"
    }
    let text = String(describing: error).split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return String(text.prefix(900))
  }
}

extension JSONEncoder {
  static let snake: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    return encoder
  }()

  func jsonObject(_ value: some Encodable) throws -> Any {
    try JSONSerialization.jsonObject(with: encode(value))
  }
}
