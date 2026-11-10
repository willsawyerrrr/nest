import Foundation
import Testing

@testable import Nest

@MainActor
@Suite struct UploadQueueTests {
    private actor Log {
        var uploaded: [String] = []
        var discarded: [String] = []
        var reads: [String] = []
        var inFlight = 0
        var peak = 0
        func upload(_ id: String) { uploaded.append(id) }
        func discard(_ path: String) { discarded.append(path) }
        func start(_ path: String) { reads.append(path); inFlight += 1; peak = max(peak, inFlight) }
        func end() { inFlight -= 1 }
    }

    private func files(_ names: String...) -> [UploadRules.PickedFile] {
        names.map { UploadRules.PickedFile(name: $0, url: URL(fileURLWithPath: "/tmp/\($0)")) }
    }

    private func queue(
        log: Log, prepared: @escaping @Sendable (String) -> UploadRules.Prepared = { name in
            .ready(UploadRules.PreparedFile(name: name, data: Data(), readable: !name.hasSuffix(".txt")))
        },
        read: @escaping @Sendable (String) async -> BulkUpload.ReadResult<String> = { .read("read \($0)") }
    ) -> UploadQueue<String> {
        UploadQueue(
            handlers: UploadHandlers(
                upload: { id, file in await log.upload(id); return "path/\(id)-\(file.name)" },
                discard: { await log.discard($0) },
                read: { path in
                    await log.start(path)
                    let result = await read(path)
                    await log.end()
                    return result
                },
                blank: { "blank" }, unsupportedMessage: "unsupported"),
            prepare: { prepared($0.name) })
    }

    private func settle(_ queue: UploadQueue<String>) async {
        for _ in 0..<500 where queue.isWorking { try? await Task.sleep(for: .milliseconds(10)) }
    }

    @Test func storesThenReadsEachFileIntoADraft() async {
        let log = Log()
        let queue = queue(log: log)
        queue.add(files("a.pdf"))
        await settle(queue)
        #expect(queue.items[0].status == .ready)
        #expect(queue.items[0].value?.hasPrefix("read path/") == true)
        #expect(await log.uploaded == [queue.items[0].id])
    }

    @Test func readsAtMostThreeAtOnce() async {
        let log = Log()
        let queue = queue(log: log) { _ in
            try? await Task.sleep(for: .milliseconds(30))
            return .read("ok")
        }
        queue.add(files("1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf", "6.pdf"))
        await settle(queue)
        #expect(queue.items.allSatisfy { $0.status == .ready })
        #expect(await log.peak <= BulkUpload.readConcurrency)
    }

    @Test func aFileOfAnUnreadableTypeIsStoredWithABlankDraft() async {
        let log = Log()
        let queue = queue(log: log)
        queue.add(files("notes.txt"))
        await settle(queue)
        #expect(queue.items[0].status == .unsupported)
        #expect(queue.items[0].value == "blank" && queue.items[0].message == "unsupported")
        #expect(await log.reads.isEmpty)
    }

    @Test func anOversizedFileFailsWithoutRetryAndTheOthersCarryOn() async {
        let log = Log()
        let queue = queue(
            log: log,
            prepared: { name in
                name == "big.pdf"
                    ? .tooLarge(message: UploadRules.fileTooLargeMessage)
                    : .ready(UploadRules.PreparedFile(name: name, data: Data(), readable: true))
            })
        queue.add(files("big.pdf", "ok.pdf"))
        await settle(queue)
        #expect(queue.items[0].status == .failed && !queue.items[0].retryable)
        #expect(queue.items[0].message == UploadRules.fileTooLargeMessage)
        #expect(queue.items[1].status == .ready)
    }

    @Test func aHaltStopsTheQueueAndMarksTheRestFailed() async {
        let log = Log()
        let queue = queue(log: log) { _ in .halt(message: "off") }
        queue.add(files("1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf"))
        await settle(queue)
        #expect(queue.halted == "off")
        #expect(queue.items.allSatisfy { $0.status == .failed && $0.message == "off" })
        #expect(await log.reads.count <= BulkUpload.readConcurrency)
    }

    @Test func aRetryReadsAgainWithoutStoringAgain() async {
        let log = Log()
        let queue = queue(log: log) { _ in .failed(message: "no") }
        queue.add(files("1.pdf"))
        await settle(queue)
        #expect(queue.items[0].status == .failed)
        queue.retry(queue.items[0].id)
        await settle(queue)
        #expect(await log.uploaded.count == 1 && await log.reads.count == 2)
        queue.enterByHand(queue.items[0].id)
        #expect(queue.items[0].status == .manual && queue.items[0].value == "blank")
    }

    @Test func leftOutFilesPastTheBatchLimitAreCounted() {
        let log = Log()
        let queue = queue(log: log)
        let many = (0..<23).map { UploadRules.PickedFile(name: "\($0).pdf", url: URL(fileURLWithPath: "/tmp/\($0)")) }
        #expect(queue.add(many) == 3)
        #expect(queue.items.count == 20 && queue.skipped == 3)
    }

    @Test func removingAndClearingDeleteStoredFilesNoRecordReferences() async {
        let log = Log()
        let queue = queue(log: log)
        queue.add(files("1.pdf", "2.pdf", "3.pdf"))
        await settle(queue)
        let saved = queue.items[0].id
        queue.keep(saved)
        queue.finish(saved, saved: true)
        queue.remove(queue.items[1].id)
        queue.clear()
        try? await Task.sleep(for: .milliseconds(50))
        let discarded = await log.discarded
        #expect(discarded.count == 2)
        #expect(!discarded.contains { $0.contains(saved) })
    }
}
