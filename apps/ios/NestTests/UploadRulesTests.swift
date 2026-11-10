import Foundation
import Testing

@testable import Nest

@Suite struct UploadRulesTests {
    @Test func theExtensionDecidesWhatIsReadAndHowItIsStored() {
        #expect(UploadRules.canExtract("slip.PDF"))
        #expect(UploadRules.canExtract("slip.webp"))
        #expect(!UploadRules.canExtract("slip.heic"))
        #expect(!UploadRules.canExtract("slip"))
        #expect(UploadRules.storedContentType("a.jpeg") == "image/jpeg")
        #expect(UploadRules.storedContentType("a.html") == "application/octet-stream")
    }

    @Test func theLimitIs25MiB() {
        #expect(UploadRules.maxBytes == 26_214_400)
        #expect(UploadRules.fileTooLargeMessage == "That file is too large. The limit is 25 MB.")
        #expect(ShareInbox.maxFileBytes == Int64(UploadRules.maxBytes))
    }

    @Test func keyNamesAreSafe() {
        #expect(UploadRules.storageKeyName("My Payslip (1).pdf") == "My_Payslip_1_.pdf")
        #expect(UploadRules.storageKeyName("résumé.pdf") == "resume.pdf")
        #expect(UploadRules.storageKeyName("..hidden") == "hidden")
        #expect(UploadRules.storageKeyName("???") == "_")
        #expect(UploadRules.storageKeyName("") == "file")
        let long = UploadRules.storageKeyName(String(repeating: "a", count: 300) + ".pdf")
        #expect(long.count == 100 && long.hasSuffix(".pdf"))
    }

    @Test func objectPathsLiveUnderTheHouseholdAndRecord() {
        let path = UploadRules.objectPath(household: "h", record: "r", name: "a b.pdf")
        #expect(path.hasPrefix("h/r/") && path.hasSuffix("-a_b.pdf"))
        #expect(UploadRules.downloadName(path) == "a_b.pdf")
    }

    @Test func aBatchIsCutToTwentyWithTheUsualMessage() {
        #expect(BulkUpload.maxBatchFiles == 20 && BulkUpload.readConcurrency == 3)
        #expect(BulkUpload.limitMessage(skipped: 1).hasPrefix("1 file was left out"))
        #expect(BulkUpload.limitMessage(skipped: 3).hasPrefix("3 files were left out"))
    }

    @Test func preparingAReadableFileKeepsItsName() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).pdf")
        try Data("pdf".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(
            UploadRules.prepare(UploadRules.PickedFile(name: "slip.pdf", url: url))
                == .ready(UploadRules.PreparedFile(name: "slip.pdf", data: Data("pdf".utf8), readable: true)))
        #expect(
            UploadRules.prepare(UploadRules.PickedFile(name: "notes.txt", url: url))
                == .ready(UploadRules.PreparedFile(name: "notes.txt", data: Data("pdf".utf8), readable: false)))
    }
}
