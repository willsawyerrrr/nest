import Foundation

/// The document (and kind) a run has reached.
struct DocumentProgress: Sendable, Equatable {
  /// The document and kind, such as `payslip-01:payslip`.
  let id: String
  /// One-based position among all documents of the arm.
  let index: Int
  let total: Int
}

/// Estimates the time left from a rolling window of recent per-document durations.
struct RollingETA {
  let window: Int
  private(set) var durations: [TimeInterval] = []

  init(window: Int = 10) { self.window = max(1, window) }

  mutating func record(_ duration: TimeInterval) {
    durations.append(duration)
    if durations.count > window { durations.removeFirst(durations.count - window) }
  }

  /// Seconds left for `remaining` documents, or `nil` before any duration is recorded.
  func remaining(_ remaining: Int) -> TimeInterval? {
    guard !durations.isEmpty else { return nil }
    return durations.reduce(0, +) / Double(durations.count) * Double(max(0, remaining))
  }
}

/// Which arms a resumed run still has to do.
enum Resume {
  /// Whether `file` holds the results of a finished arm: a JSON object without an arm error.
  static func isComplete(_ file: URL) -> Bool {
    guard let data = try? Data(contentsOf: file),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }
    return object["armError"] == nil
  }

  /// The engines in `engines` with no finished results file in `results`.
  static func pending(_ engines: [String], results: URL) -> [String] {
    engines.filter { !isComplete(results.appending(path: "\($0).json")) }
  }
}

/// Spots gaps between ticks that mean the process was suspended, as when the phone locks.
struct SuspensionDetector {
  let threshold: TimeInterval
  private var last: Date?

  init(threshold: TimeInterval = 5, start: Date? = nil) {
    self.threshold = threshold
    last = start
  }

  /// Records a tick and returns the gap in seconds when it exceeds the threshold.
  mutating func tick(_ now: Date) -> TimeInterval? {
    defer { last = now }
    guard let last else { return nil }
    let gap = now.timeIntervalSince(last)
    return gap > threshold ? gap : nil
  }
}

/// Formats a duration as `h:mm:ss` or `m:ss`.
func clock(_ seconds: TimeInterval) -> String {
  let total = Int(max(0, seconds))
  let (hours, minutes, secs) = (total / 3600, total % 3600 / 60, total % 60)
  return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
}
