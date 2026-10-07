import Foundation
import Testing

@testable import Nest

@Suite struct ShareInboxTests {
    private func makeInbox() throws -> ShareInbox {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("inbox-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return ShareInbox(root: root)
    }

    private func makeSource(_ name: String, bytes: Int = 4) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("src-\(UUID().uuidString)-\(name)")
        try Data(repeating: 7, count: bytes).write(to: url)
        return url
    }

    @Test func keepsASupportedFileUnderItsOwnName() throws {
        let inbox = try makeInbox()
        let result = inbox.store(
            fileAt: try makeSource("r.pdf"), name: "Receipt.PDF", typeIdentifier: "com.adobe.pdf")

        guard case .stored(let id) = result else {
            Issue.record("expected stored, got \(result)")
            return
        }
        let items = inbox.pending()
        #expect(items.map(\.id) == [id])
        #expect(items[0].name == "Receipt.PDF")
        #expect(items[0].mimeType == "application/pdf")
        #expect(items[0].size == 4)
    }

    @Test func namesAnImageByItsTypeWhenTheNameHasNoExtension() {
        #expect(ShareInbox.resolvedName("photo", typeIdentifier: "public.jpeg") == "photo.jpeg")
        #expect(ShareInbox.resolvedName("scan.heic", typeIdentifier: nil) == "scan.heic")
        #expect(ShareInbox.resolvedName("", typeIdentifier: "public.png") == "file.png")
    }

    @Test func rejectsTypesThatAreNeitherPDFNorImage() throws {
        let inbox = try makeInbox()

        #expect(
            inbox.store(
                fileAt: try makeSource("a.docx"), name: "a.docx", typeIdentifier: "org.openxmlformats.wordprocessingml.document"
            ) == .unsupported)
        #expect(
            inbox.store(fileAt: try makeSource("a"), name: "a", typeIdentifier: nil) == .unsupported)
        #expect(inbox.pending().isEmpty)
    }

    @Test func rejectsAFileOverTheLimitButKeepsOneAtIt() throws {
        let inbox = try makeInbox()
        let limit = Int(ShareInbox.maxFileBytes)

        #expect(
            inbox.store(fileAt: try makeSource("a.pdf", bytes: limit + 1), name: "a.pdf", typeIdentifier: nil)
                == .tooLarge)
        guard
            case .stored = inbox.store(
                fileAt: try makeSource("b.pdf", bytes: limit), name: "b.pdf", typeIdentifier: nil)
        else {
            Issue.record("a file at the limit should be kept")
            return
        }
    }

    @Test func reportsAMissingSourceAsFailed() throws {
        let inbox = try makeInbox()
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("nope.pdf")

        #expect(inbox.store(fileAt: missing, name: "nope.pdf", typeIdentifier: nil) == .failed)
    }

    @Test func listsOldestFirstAndSkipsIncompleteDirectories() throws {
        let inbox = try makeInbox()
        let t0 = Date(timeIntervalSince1970: 1_000)
        _ = inbox.store(fileAt: try makeSource("b.pdf"), name: "b.pdf", typeIdentifier: nil, now: t0 + 10)
        _ = inbox.store(fileAt: try makeSource("a.pdf"), name: "a.pdf", typeIdentifier: nil, now: t0)
        try FileManager.default.createDirectory(
            at: inbox.root.appendingPathComponent(UUID().uuidString), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(
            at: inbox.root.appendingPathComponent("not-an-id"), withIntermediateDirectories: true)

        #expect(inbox.pending().map(\.name) == ["a.pdf", "b.pdf"])
    }

    @Test func removeDeletesAnItemAndIgnoresForeignIds() throws {
        let inbox = try makeInbox()
        guard
            case .stored(let id) = inbox.store(
                fileAt: try makeSource("a.pdf"), name: "a.pdf", typeIdentifier: nil)
        else { return }

        inbox.remove(id: "../..")
        #expect(inbox.pending().count == 1)
        inbox.remove(id: id)
        #expect(inbox.pending().isEmpty)
    }

    @Test func purgesStaleItemsAndAbandonedStagingOnly() throws {
        let inbox = try makeInbox()
        let now = Date(timeIntervalSince1970: 10_000_000)
        _ = inbox.store(
            fileAt: try makeSource("old.pdf"), name: "old.pdf", typeIdentifier: nil,
            now: now - ShareInbox.staleAfter - 1)
        _ = inbox.store(
            fileAt: try makeSource("new.pdf"), name: "new.pdf", typeIdentifier: nil, now: now - 60)
        let staging = inbox.root.appendingPathComponent(".tmp-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)

        inbox.purgeStale(now: now)

        #expect(inbox.pending().map(\.name) == ["new.pdf"])
        #expect(FileManager.default.fileExists(atPath: staging.path))

        inbox.purgeStale(now: Date().addingTimeInterval(ShareInbox.staleAfter + 60))
        #expect(!FileManager.default.fileExists(atPath: staging.path))
    }

    @Test func staleBoundaryIsExclusive() {
        let now = Date(timeIntervalSince1970: 5_000_000)
        #expect(!ShareInbox.isStale(now - ShareInbox.staleAfter, now: now))
        #expect(ShareInbox.isStale(now - ShareInbox.staleAfter - 1, now: now))
    }

    @Test func undeliveredSkipsWhatWasAlreadySent() {
        func item(_ id: String) -> ShareInbox.Item {
            ShareInbox.Item(
                id: id, name: "a.pdf", mimeType: "application/pdf", size: 1,
                createdAt: Date(), fileURL: URL(fileURLWithPath: "/dev/null"))
        }

        #expect(
            ShareInbox.undelivered([item("a"), item("b")], delivered: ["a"]).map(\.id) == ["b"])
    }
}

@Suite struct ShareSummaryTests {
    @Test func describesWhatWasSaved() {
        var summary = ShareSummary()
        summary.record(.stored(id: "1"))
        #expect(summary.message == "Saved to Nest. Open Nest to review.")
        summary.record(.stored(id: "2"))
        #expect(summary.message == "Saved 2 files to Nest. Open Nest to review.")
    }

    @Test func namesEachReasonAFileWasLeftOut() {
        var summary = ShareSummary()
        summary.record(.unsupported)
        summary.record(.tooLarge)
        summary.record(.tooLarge)
        summary.record(.failed)

        #expect(
            summary.message
                == "1 file was not a PDF or image.\n2 files were over 25 MB.\n1 file could not be saved."
        )
    }

    @Test func saysSoWhenThereWasNothing() {
        #expect(ShareSummary().message == "Nothing to save.")
    }
}

@Suite struct ShareBridgeTests {
    @Test func scriptsEscapeTheirArguments() {
        #expect(
            ShareBridge.beginScript(id: "i", name: #"a"b.pdf"#, mimeType: "application/pdf")
                == #"window.__nestShare.begin("i", "a\"b.pdf", "application\/pdf"); true;"#)
        #expect(
            ShareBridge.chunkScript(id: "i", base64: "QUJD") == #"window.__nestShare.chunk("i", "QUJD"); true;"#)
        #expect(ShareBridge.finishScript(id: "i") == #"window.__nestShare.finish("i"); true;"#)
    }

    @Test func readsOnlyValidIDsFromAQueuedMessage() {
        let id = UUID().uuidString
        #expect(ShareBridge.queuedIDs(from: ["type": "queued", "ids": [id, "../x"]]) == [id])
        #expect(ShareBridge.queuedIDs(from: ["type": "other", "ids": [id]]).isEmpty)
        #expect(ShareBridge.queuedIDs(from: "nope").isEmpty)
    }
}
