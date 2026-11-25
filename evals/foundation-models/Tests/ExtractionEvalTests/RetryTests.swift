import Foundation
import FoundationModels
import Testing

@testable import ExtractionEval

struct RetryTests {
  private static let limited = LanguageModelError.rateLimited(.init(resetDate: nil, debugDescription: "Request has been rate limited"))
  private struct Other: Error {}
  private let policy = RetryPolicy(attempts: 3, baseMs: 100, capMs: 250, thermalPollMs: 10, thermalMaxMs: 30)

  @Test func detectsARateLimit() {
    #expect(Retry.isRateLimited(Self.limited))
    #expect(Retry.isRateLimited(EvalError("Request has been rate limited")))
    #expect(!Retry.isRateLimited(Other()))
  }

  @Test func backoffDoublesUpToTheCapAndHonoursALaterReset() {
    #expect((1...4).map { Retry.delayMs(retry: $0, policy: policy) } == [100, 200, 250, 250])
    #expect(Retry.delayMs(retry: 1, policy: policy, resetsIn: 180) == 180)
    #expect(Retry.delayMs(retry: 1, policy: policy, resetsIn: 9_999) == 250)
  }

  @Test func retriesARateLimitThenSucceeds() async throws {
    var calls = 0
    var sleeps: [Int] = []
    let out = await Retry.perform(policy: policy, label: "d", thermal: { "nominal" }, sleep: { sleeps.append($0) }, progress: { _ in }) {
      calls += 1
      if calls < 3 { throw Self.limited }
      return "ok"
    }
    #expect(try out.result.get() == "ok")
    #expect(out.stats == RetryStats(retries: 2, waitedMs: 300))
    #expect(sleeps == [100, 200] && !out.rateLimited)
  }

  @Test func givesUpAfterTheAttemptsAndFlagsRateLimited() async {
    var calls = 0
    let out = await Retry.perform(policy: policy, label: "d", thermal: { "nominal" }, sleep: { _ in }, progress: { _ in }) {
      calls += 1
      throw Self.limited
    } as (result: Result<Int, Error>, stats: RetryStats, rateLimited: Bool)
    #expect(calls == 3 && out.rateLimited)
    #expect(out.stats.retries == 2)
    #expect(throws: LanguageModelError.self) { try out.result.get() }
  }

  @Test func doesNotRetryAnotherError() async {
    var calls = 0
    let out = await Retry.perform(policy: policy, label: "d", thermal: { "nominal" }, sleep: { _ in }, progress: { _ in }) {
      calls += 1
      throw Other()
    } as (result: Result<Int, Error>, stats: RetryStats, rateLimited: Bool)
    #expect(calls == 1 && !out.rateLimited && out.stats == RetryStats())
  }

  @Test func waitsWhileHotUpToTheBound() async throws {
    var messages: [String] = []
    let out = await Retry.perform(policy: policy, label: "d", thermal: { "serious" }, sleep: { _ in }, progress: { messages.append($0) }) { 1 }
    #expect(try out.result.get() == 1)
    #expect(out.stats == RetryStats(retries: 0, waitedMs: 30))
    #expect(messages.count == 3)
  }

  @Test func coolsBeforeAttemptingOnceTheStateDrops() async {
    var states = ["critical", "serious", "fair"]
    let out = await Retry.perform(policy: policy, label: "d", thermal: { states.count > 1 ? states.removeFirst() : states[0] }, sleep: { _ in }, progress: { _ in }) { 1 }
    #expect(out.stats.waitedMs > 0 && out.stats.waitedMs <= 30)
  }

  @Test func aRateLimitedResultRecordsItsRetriesAndWaits() {
    var result = RunResult(ms: 40)
    result.rateLimited = true
    result.retries = 4
    result.waitedMs = 31_000
    let json = result.json
    #expect(json["rateLimited"] as? Bool == true)
    #expect(json["retries"] as? Int == 4 && json["waitedMs"] as? Int == 31_000)
    #expect(RunResult(ms: 1).json["rateLimited"] == nil)
  }
}
