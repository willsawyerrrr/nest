import CryptoKit
import FoundationModels
import Observation
import SwiftUI

/// One arm of a run: an input path under a model and sampling mode.
struct Arm: Hashable {
  let model: ModelChoice
  let path: InputPath
  let sampling: Sampling

  var engine: String { "fm-\(model.rawValue)-\(path.rawValue)" + (sampling == .greedy ? "-greedy" : "") }
}

/// The settings behind a run and the progress of the one in flight.
@Observable @MainActor
final class EvalModel {
  var paths: Set<InputPath> = [.pdftext]
  var models: Set<ModelChoice> = [.system]
  var samplings: Set<Sampling> = [.default]
  var repeats = 5
  var only = ""
  var cross = false
  /// Skips arms that already have a finished results file.
  var resume = false

  private(set) var status = "Idle"
  private(set) var running = false
  private(set) var log: [String] = []
  private(set) var results: [URL] = []
  private(set) var corpusCount: Int?
  private(set) var progress: RunProgressState?
  /// How long the process was last suspended, such as while the phone was locked.
  private(set) var suspendedFor: TimeInterval?

  private let keepAlive = KeepAlive()
  private var eta = RollingETA()
  private var documentStarted = Date()
  private var ticker: Task<Void, Never>?

  /// The app's Documents folder, which the Files app shows under Nest Eval: corpus files go in, `results/` comes out.
  let root = URL.documentsDirectory

  init() { refresh() }

  func refresh() {
    corpusCount = (try? CorpusDoc.loadAll(from: root))?.count
    let out = root.appending(path: "results")
    results =
      ((try? FileManager.default.contentsOfDirectory(at: out, includingPropertiesForKeys: nil)) ?? [])
      .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
  }

  /// Copies a folder picked in the Files app into Documents, replacing what it overwrites.
  /// Picking Documents itself leaves everything in place.
  func importFolder(_ result: Result<URL, Error>) {
    do {
      let source = try result.get()
      guard source.startAccessingSecurityScopedResource() else { throw EvalError("cannot access \(source.lastPathComponent)") }
      defer { source.stopAccessingSecurityScopedResource() }
      switch try CorpusImport.run(from: source, into: root) {
      case .alreadyInPlace: status = "Corpus already in place"
      case .imported(let copied): status = "Imported \(copied) items from \(source.lastPathComponent)"
      }
    } catch {
      status = "Import failed: \(error)"
    }
    refresh()
  }

  var arms: [Arm] {
    models.sorted { $0.rawValue < $1.rawValue }.flatMap { model in
      samplings.sorted { $0.rawValue < $1.rawValue }.flatMap { sampling in
        paths.sorted { $0.rawValue < $1.rawValue }.map { Arm(model: model, path: $0, sampling: sampling) }
      }
    }
  }

  func start() {
    guard !running else { return }
    running = true
    log = []
    suspendedFor = nil
    progress = nil
    eta = RollingETA()
    keepAlive.begin()
    startTicker()
    Task {
      let failed = await run()
      ticker?.cancel()
      keepAlive.end()
      running = false
      refresh()
      await Notifier.post(
        title: failed == 0 ? "Nest Eval finished" : "Nest Eval finished with failures",
        body: failed == 0 ? status : "\(failed) arms failed. \(status)")
    }
  }

  /// Ticks each second to refresh the elapsed time and notice a suspension.
  private func startTicker() {
    ticker = Task {
      var detector = SuspensionDetector(start: Date())
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        if let gap = detector.tick(Date()) {
          suspendedFor = gap
          append("Suspended for \(clock(gap)), likely while locked")
        }
        progress?.tick()
      }
    }
  }

  private func append(_ line: String) {
    log.append("\(Date.now.formatted(date: .omitted, time: .standard)) \(line)")
  }

  private func record(_ document: DocumentProgress, arm: Int, arms: Int, engine: String, runStarted: Date) {
    let now = Date()
    if let current = progress, current.document.index < document.index, current.arm == arm {
      eta.record(now.timeIntervalSince(documentStarted))
    } else if progress?.arm != arm {
      eta = RollingETA()
    }
    documentStarted = now
    keepAlive.renew()
    progress = RunProgressState(
      arm: arm, arms: arms, engine: engine, document: document, runStarted: runStarted,
      remaining: eta.remaining(document.total - document.index + 1))
    append("\(engine) \(document.index)/\(document.total) \(document.id)")
  }

  /// Runs every arm and returns how many failed.
  private func run() async -> Int {
    var failed = 0
    let arms = arms
    let ids = Set(only.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    let started = Date()
    var outcomes: [[String: Any]] = []
    let pending = Set(Resume.pending(arms.map(\.engine), results: root.appending(path: "results")))
    for (index, arm) in arms.enumerated() {
      status = "\(index + 1)/\(arms.count) \(arm.engine)"
      var outcome: [String: Any] = ["engine": arm.engine]
      if resume && !pending.contains(arm.engine) {
        outcome["status"] = "skipped"
        outcomes.append(outcome)
        append("\(arm.engine) skipped, results exist")
        continue
      }
      do {
        if arm.model == .pcc, case .unavailable(let reason) = PrivateCloudComputeLanguageModel().availability {
          throw EvalError("pcc unavailable: \(reason)")
        }
        let (armNumber, armCount, engine, runStarted) = (index + 1, arms.count, arm.engine, started)
        try await Run.run(
          dir: root, path: arm.path, model: arm.model, sampling: arm.sampling, repeats: repeats, only: ids, cross: cross,
          progress: { document in
            Task { @MainActor in self.record(document, arm: armNumber, arms: armCount, engine: engine, runStarted: runStarted) }
          })
        outcome["status"] = "completed"
      } catch {
        outcome["status"] = "failed"
        outcome["error"] = String(describing: error)
        failed += 1
        append("\(arm.engine) failed: \(error)")
        try? await writeFailure(arm, error: String(describing: error))
      }
      outcomes.append(outcome)
      refresh()
    }
    status = "Done"
    progress = nil
    try? writeRunRecord(started: started, outcomes: outcomes)
    return failed
  }

  /// A results file with no documents scored, so an arm that cannot run reads as a failure and not a gap.
  private func writeFailure(_ arm: Arm, error: String) async throws {
    let out = root.appending(path: "results")
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let payload = try JSONSerialization.data(
      withJSONObject: [
        "engine": arm.engine, "sampling": arm.sampling.rawValue, "repeats": repeats,
        "device": await Device.snapshot(arm.model), "armError": error, "results": [String: Any](),
      ], options: [.prettyPrinted, .sortedKeys])
    try payload.write(to: out.appending(path: "\(arm.engine).json"))
  }

  /// What produced the results: hardware, corpus hash, app build and every arm's outcome.
  private func writeRunRecord(started: Date, outcomes: [[String: Any]]) throws {
    let fm = FileManager.default
    var hash = SHA256()
    for name in ["corpus.json", "strata.json", "manifest.json"] {
      if let data = try? Data(contentsOf: root.appending(path: name)) { hash.update(data: data) }
    }
    let info = Bundle.main.infoDictionary ?? [:]
    let record: [String: Any] = [
      "startedAt": ISO8601DateFormatter().string(from: started),
      "finishedAt": ISO8601DateFormatter().string(from: Date()),
      "hardware": Hardware.identifier,
      "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      "corpusSha256": hash.finalize().map { String(format: "%02x", $0) }.joined(),
      "appVersion": info["CFBundleShortVersionString"] ?? "",
      "gitCommit": info["EvalGitCommit"] ?? "",
      "repeats": repeats, "only": only, "cross": cross,
      "arms": outcomes,
    ]
    let out = root.appending(path: "results")
    try fm.createDirectory(at: out, withIntermediateDirectories: true)
    let stamp = ISO8601DateFormatter().string(from: started).replacingOccurrences(of: ":", with: "-")
    try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys])
      .write(to: out.appending(path: "run-\(stamp).json"))
  }
}

/// Where a run has reached, for display.
struct RunProgressState {
  let arm: Int
  let arms: Int
  let engine: String
  let document: DocumentProgress
  let runStarted: Date
  /// Seconds left in the arm, from recent documents.
  let remaining: TimeInterval?
  private(set) var elapsed: TimeInterval = 0

  init(arm: Int, arms: Int, engine: String, document: DocumentProgress, runStarted: Date, remaining: TimeInterval?) {
    (self.arm, self.arms, self.engine, self.document, self.runStarted, self.remaining) = (arm, arms, engine, document, runStarted, remaining)
  }

  mutating func tick() { elapsed = Date().timeIntervalSince(runStarted) }
}

enum Hardware {
  /// The hardware model identifier, such as `iPhone18,3`.
  static var identifier: String {
    var size = 0
    sysctlbyname("hw.machine", nil, &size, nil, 0)
    var buffer = [CChar](repeating: 0, count: size)
    sysctlbyname("hw.machine", &buffer, &size, nil, 0)
    return String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
  }
}
