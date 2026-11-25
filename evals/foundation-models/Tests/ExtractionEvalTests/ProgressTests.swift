import Foundation
import Testing

@testable import ExtractionEval

@Suite struct ProgressTests {
  @Test func noEstimateBeforeAnyDocumentFinishes() {
    #expect(RollingETA().remaining(5) == nil)
  }

  @Test func estimateIsTheMeanDurationTimesRemaining() {
    var eta = RollingETA()
    eta.record(10)
    eta.record(20)
    #expect(eta.remaining(4) == 60)
    #expect(eta.remaining(0) == 0)
  }

  @Test func onlyTheWindowCounts() {
    var eta = RollingETA(window: 2)
    for duration in [100, 10, 20] as [TimeInterval] { eta.record(duration) }
    #expect(eta.remaining(1) == 15)
  }

  @Test func detectsAGapBeyondTheThreshold() {
    let start = Date(timeIntervalSince1970: 0)
    var detector = SuspensionDetector(threshold: 5, start: start)
    #expect(detector.tick(start.addingTimeInterval(1)) == nil)
    #expect(detector.tick(start.addingTimeInterval(61)) == 60)
    #expect(detector.tick(start.addingTimeInterval(62)) == nil)
  }

  @Test func firstTickWithoutAStartIsNeverAGap() {
    var detector = SuspensionDetector()
    #expect(detector.tick(Date()) == nil)
  }

  @Test func formatsClock() {
    #expect(clock(65) == "1:05")
    #expect(clock(3725) == "1:02:05")
    #expect(clock(-3) == "0:00")
  }

  @Test func resumeSkipsFinishedArmsOnly() throws {
    let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try #"{"engine":"a","results":{}}"#.write(to: dir.appending(path: "a.json"), atomically: true, encoding: .utf8)
    try #"{"engine":"b","armError":"boom","results":{}}"#.write(to: dir.appending(path: "b.json"), atomically: true, encoding: .utf8)
    try "not json".write(to: dir.appending(path: "c.json"), atomically: true, encoding: .utf8)
    #expect(Resume.pending(["a", "b", "c", "d"], results: dir) == ["b", "c", "d"])
  }
}
