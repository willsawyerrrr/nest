import Foundation
import FoundationModels

/// How a rate-limited request is retried and how long the run waits for a warm device to cool.
struct RetryPolicy {
  /// Attempts at one request, the first included.
  var attempts = 5
  /// The wait before the first retry; each retry doubles it.
  var baseMs = 1_000
  /// The longest wait before any one retry.
  var capMs = 30_000
  /// How often the thermal state is re-read while waiting.
  var thermalPollMs = 5_000
  /// The longest a request waits for the thermal state to drop below `serious`, per attempt.
  var thermalMaxMs = 120_000
}

/// What retrying a request cost, recorded on its result.
struct RetryStats: Equatable {
  var retries = 0
  var waitedMs = 0
}

enum Retry {
  /// Whether the model refused the request for being rate limited.
  static func isRateLimited(_ error: Error) -> Bool {
    if let error = error as? LanguageModelError, case .rateLimited = error { return true }
    return String(describing: error).lowercased().contains("rate limit")
  }

  /// The wait before retry number `retry` (from 1): the backoff doubling from the base up to the cap, or
  /// the model's own reset time when it is later and within the cap.
  static func delayMs(retry: Int, policy: RetryPolicy, resetsIn: Int? = nil) -> Int {
    let backoff = min(policy.capMs, policy.baseMs << min(retry - 1, 20))
    return max(backoff, min(policy.capMs, resetsIn ?? 0))
  }

  /// Whether the thermal state asks the run to wait.
  static func isHot(_ thermalState: String) -> Bool {
    thermalState == "serious" || thermalState == "critical"
  }

  /// Runs `operation`, waiting while the device is hot before each attempt and retrying a rate-limited
  /// one with backoff up to `policy.attempts`. Any other error is thrown at once. The result carries the
  /// retries and milliseconds waited; `rateLimited` is set when every attempt was rate limited.
  /// `progress` reports each wait; `thermal` and `sleep` are injectable so waits can be tested.
  static func perform<T>(
    policy: RetryPolicy = RetryPolicy(),
    label: String,
    thermal: () -> String = { Device.thermalState },
    sleep: (Int) async -> Void = { try? await Task.sleep(for: .milliseconds($0)) },
    progress: (String) -> Void = { print($0) },
    _ operation: () async throws -> T
  ) async -> (result: Result<T, Error>, stats: RetryStats, rateLimited: Bool) {
    var stats = RetryStats()
    for attempt in 1...policy.attempts {
      var waitedForCooling = 0
      while isHot(thermal()), waitedForCooling < policy.thermalMaxMs {
        progress("\(label): device \(thermal()), cooling \(policy.thermalPollMs / 1000)s")
        await sleep(policy.thermalPollMs)
        waitedForCooling += policy.thermalPollMs
        stats.waitedMs += policy.thermalPollMs
      }
      do {
        return (.success(try await operation()), stats, false)
      } catch {
        guard isRateLimited(error) else { return (.failure(error), stats, false) }
        guard attempt < policy.attempts else { return (.failure(error), stats, true) }
        let resets = (error as? LanguageModelError).flatMap { error -> Int? in
          guard case .rateLimited(let limit) = error, let date = limit.resetDate else { return nil }
          return Int(date.timeIntervalSinceNow * 1000)
        }
        let wait = delayMs(retry: attempt, policy: policy, resetsIn: resets)
        progress("\(label): rate limited, retry \(attempt)/\(policy.attempts - 1) in \(wait)ms")
        await sleep(wait)
        stats.retries += 1
        stats.waitedMs += wait
      }
    }
    fatalError("attempts is at least 1")
  }
}
