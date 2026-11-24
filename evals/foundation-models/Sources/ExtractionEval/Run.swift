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
  /// The rendered PNG cut into overlapping horizontal bands, each its own image attachment.
  case imageHires = "image-hires"
  /// The Vision transcript and the rendered PNG together.
  case ocrImage = "ocr+image"
}

/// How the model samples its answer.
enum Sampling: String {
  case greedy
  case `default`

  var options: GenerationOptions {
    GenerationOptions(samplingMode: self == .greedy ? .greedy : nil)
  }
}

/// Which model answers.
enum ModelChoice: String {
  case system
  case pcc
}

enum Run {
  /// Whether the process has generated yet; the first generation pays model load and warm-up.
  nonisolated(unsafe) private static var generated = false

  static func run(
    dir: URL, path: InputPath, model: ModelChoice, sampling: Sampling, repeats: Int, only: Set<String>, cross: Bool = false
  ) async throws {
    let corpus = try CorpusDoc.loadAll(from: dir)
    let files = dir.appending(path: "files")
    let device = await Device.snapshot(model)
    var results: [String: [String: Any]] = [:]
    for doc in corpus where only.isEmpty || only.contains(doc.id) {
      // A picture-only variant has no text layer for the PDF text path to read.
      if path == .pdftext && doc.textLayer == false { continue }
      let kinds = doc.kind == "other" || cross ? ["payslip", "deduction", "trade"] : [doc.kind]
      for kind in kinds {
        var runs: [[String: Any]] = []
        for repeatIndex in 0..<repeats {
          let timing = generated ? "warm" : "cold"
          generated = true
          let thermal = Device.thermalState
          let started = ContinuousClock.now
          var result = RunResult(ms: 0)
          do {
            if let reason = Pages.unreadable(files.appending(path: "\(doc.id).pdf")) {
              result.unreadable = reason
            } else {
              let (raw, tokens) = try await extract(
                doc, kind: kind, path: path, model: model, sampling: sampling, dir: dir)
              result.raw = raw
              result.promptTokens = tokens
            }
          } catch {
            result.error = describe(error)
          }
          let elapsed = ContinuousClock.now - started
          result.ms = Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
          var json = result.json
          json["repeat"] = repeatIndex
          json["sampling"] = sampling.rawValue
          json["timing"] = timing
          json["thermalState"] = thermal
          json["lowPowerMode"] = ProcessInfo.processInfo.isLowPowerModeEnabled
          json.merge(device) { $1 }
          runs.append(json)
          print(
            "\(doc.id):\(kind)#\(repeatIndex)", result.error ?? result.unreadable.map { "unreadable(\($0))" } ?? "ok", "\(result.ms)ms", timing, thermal,
            result.promptTokens.map { "\($0) tokens" } ?? "")
        }
        // The first repeat is the result the scorer reads; `runs` holds every repeat.
        var entry = runs[0]
        entry["runs"] = runs
        results["\(doc.id):\(kind)"] = entry
      }
    }
    let engine = "fm-\(model.rawValue)-\(path.rawValue)" + (sampling == .greedy ? "-greedy" : "")
    let out = dir.appending(path: "results")
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let payload = try JSONSerialization.data(
      withJSONObject: [
        "engine": engine,
        "sampling": sampling.rawValue,
        "repeats": repeats,
        "device": device,
        "results": results,
      ], options: [.prettyPrinted, .sortedKeys])
    try payload.write(to: out.appending(path: "\(engine).json"))
  }

  /// One document through one extractor: returns the raw fields as JSON and the prompt's token count.
  private static func extract(
    _ doc: CorpusDoc, kind: String, path: InputPath, model: ModelChoice, sampling: Sampling, dir: URL
  ) async throws -> (Any, Int?) {
    let files = dir.appending(path: "files")
    let ask = Instructions.ask(for: kind)
    let pages = Pages.images(of: doc.id, in: files)
    let shown = pages.count == 1 ? "The document is one page." : "The document has \(pages.count) pages, shown in order."
    let prompt: Prompt
    switch path {
    case .pdftext:
      prompt = Prompt("\(ask)\n\nDocument text:\n\(try DocumentText.pdfText(files.appending(path: "\(doc.id).pdf")))")
    case .ocr:
      prompt = Prompt("\(ask)\n\nDocument text:\n\(try await DocumentText.ocr(pages: pages))")
    case .image:
      prompt = Prompt {
        "\(ask)\n\n\(shown)"
        for page in pages { Attachment(imageURL: page) }
      }
    case .imageHires:
      let tiles = try Tiles.bands(ofPages: pages)
      prompt = Prompt {
        "\(ask)\n\n\(shown) Each page is shown as \(Tiles.count) overlapping bands from top to bottom, \(tiles.count) images in all."
        for tile in tiles { Attachment(tile) }
      }
    case .ocrImage:
      let transcript = try await DocumentText.ocr(pages: pages)
      prompt = Prompt {
        "\(ask)\n\n\(shown)\n\nDocument text:\n\(transcript)"
        for page in pages { Attachment(imageURL: page) }
      }
    }
    let instructions = Instructions.text(for: kind, financialYear: doc.financialYear)
    switch model {
    case .system:
      return try await generate(kind, SystemLanguageModel.default, instructions, prompt, sampling)
    case .pcc:
      return try await generate(kind, PrivateCloudComputeLanguageModel(), instructions, prompt, sampling)
    }
  }

  private static func generate(
    _ kind: String, _ model: some LanguageModel, _ instructions: String, _ prompt: Prompt,
    _ sampling: Sampling
  ) async throws -> (Any, Int?) {
    let session = LanguageModelSession(model: model, instructions: instructions)
    let tokens = try? await tokenCount(model, kind, instructions, prompt)
    if let tokens, let system = model as? SystemLanguageModel,
      let message = Pages.overflow(tokens: tokens, contextSize: system.contextSize)
    {
      throw EvalError(message)
    }
    switch kind {
    case "payslip":
      return (try await JSONEncoder.snake.jsonObject(session.respond(to: prompt, generating: PayslipFields.self, options: sampling.options).content), tokens)
    case "deduction":
      return (try await JSONEncoder.snake.jsonObject(session.respond(to: prompt, generating: ReceiptFields.self, options: sampling.options).content), tokens)
    default:
      return (try await JSONEncoder.snake.jsonObject(session.respond(to: prompt, generating: TradeFields.self, options: sampling.options).content), tokens)
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
