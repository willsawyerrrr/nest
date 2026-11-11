import Foundation

/// Every write the Deductions screen makes, and the receipt files and extraction
/// behind them, mirroring the PWA's `useDeductions`, `useDeductionGroups` and
/// `useDeductionReceipts`. Writes go through `NestData`, which invalidates the cached
/// tables they touch.
struct DeductionsService: Sendable {
    static let bucket = "receipts"

    var data: NestData

    private static let deductionTables: Set<String> = ["deduction_receipt", "deduction_group"]

    // MARK: Deductions

    private struct CreateParams: Encodable, Sendable {
        let deduction: DeductionWrite
        let receiptPath: String?

        enum CodingKeys: String, CodingKey {
            case deduction = "p_deduction"
            case receiptPath = "p_receipt_path"
        }
    }

    /// Writes a new deduction and its already-stored receipt together, under the id the
    /// form minted, in one transaction (`create_deduction_with_receipt`).
    func create(_ submission: DeductionSubmission, householdID: String, financialYear: Int)
        async throws
    {
        var write = submission.write
        write.id = submission.id
        write.householdID = householdID
        write.financialYear = financialYear
        try await data.call(
            "create_deduction_with_receipt",
            params: CreateParams(deduction: write, receiptPath: submission.receiptPath),
            invalidating: Self.deductionTables.union(["deduction"]))
    }

    func update(id: String, _ write: DeductionWrite) async throws {
        try await data.update(
            Deduction.self, values: write, filters: [.eq("id", id)], also: Self.deductionTables)
    }

    func delete(id: String) async throws {
        try await data.delete(Deduction.self, filters: [.eq("id", id)], also: Self.deductionTables)
    }

    // MARK: Groups

    func createGroup(
        memberID: String, name: String, householdID: String, financialYear: Int
    ) async throws {
        try await data.insert(
            DeductionGroup.self,
            values: DeductionGroupWrite(
                householdID: householdID, financialYear: financialYear, memberID: memberID,
                name: name),
            also: ["deduction"])
    }

    func updateGroup(id: String, memberID: String, name: String) async throws {
        try await data.update(
            DeductionGroup.self,
            values: DeductionGroupWrite(memberID: memberID, name: name),
            filters: [.eq("id", id)], also: ["deduction"])
    }

    /// Drops the group; its payments stand as ordinary deductions.
    func deleteGroup(id: String) async throws {
        try await data.delete(DeductionGroup.self, filters: [.eq("id", id)], also: ["deduction"])
    }

    // MARK: Receipts

    private struct ReceiptInsert: Encodable, Sendable {
        let deductionID: String
        let storagePath: String
        let householdID: String

        enum CodingKeys: String, CodingKey {
            case deductionID = "deduction_id"
            case storagePath = "storage_path"
            case householdID = "household_id"
        }
    }

    private struct ReceiptReplace: Encodable, Sendable {
        let storagePath: String

        enum CodingKeys: String, CodingKey { case storagePath = "storage_path" }
    }

    /// Stores `file` under `deductionID` in Storage without a `deduction_receipt` row, for
    /// a deduction not yet created. Resolves to the object's path.
    func uploadPending(householdID: String, deductionID: String, file: UploadRules.PreparedFile)
        async throws -> String
    {
        let path = UploadRules.objectPath(household: householdID, record: deductionID, name: file.name)
        try await data.api.upload(
            bucket: Self.bucket, path: path, data: file.data,
            contentType: UploadRules.storedContentType(file.name))
        return path
    }

    /// Deletes an uploaded object no deduction references. Best effort.
    func discard(path: String) async {
        try? await data.api.remove(bucket: Self.bucket, paths: [path])
    }

    /// Attaches `file` as a deduction's receipt: stores it and records a receipt row, or
    /// repoints `existing` and deletes the object it held.
    func attach(
        householdID: String, deductionID: String, file: UploadRules.PreparedFile,
        existing: DeductionReceipt?
    ) async throws {
        let path = try await uploadPending(
            householdID: householdID, deductionID: deductionID, file: file)
        guard let existing else {
            try await data.insert(
                DeductionReceipt.self,
                values: ReceiptInsert(
                    deductionID: deductionID, storagePath: path, householdID: householdID))
            return
        }
        try await data.update(
            DeductionReceipt.self, values: ReceiptReplace(storagePath: path),
            filters: [.eq("id", existing.id)])
        await discard(path: existing.storagePath)
    }

    /// Removes a receipt's stored file and its row.
    func removeReceipt(_ receipt: DeductionReceipt) async throws {
        try await data.api.remove(bucket: Self.bucket, paths: [receipt.storagePath])
        try await data.delete(DeductionReceipt.self, filters: [.eq("id", receipt.id)])
    }

    /// A short-lived URL for viewing a stored receipt; a type that is not safe to show
    /// is forced to download. Nil on failure.
    func signedURL(path: String) async -> URL? {
        guard let url = try? await data.api.signedURL(bucket: Self.bucket, path: path) else {
            return nil
        }
        guard !UploadRules.canExtract(path) else { return url }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let existing = components?.queryItems ?? []
        components?.queryItems = existing + [
            URLQueryItem(name: "download", value: Self.downloadName(path))
        ]
        return components?.url ?? url
    }

    /// The stored object's name without its generated `<uuid>-` prefix.
    static func downloadName(_ path: String) -> String {
        let base = path.split(separator: "/").last.map(String.init) ?? path
        return base.replacingOccurrences(
            of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-",
            with: "", options: .regularExpression)
    }

    private struct ExtractBody: Encodable, Sendable {
        let path: String
        let category: DeductionCategory
        let financialYear: Int
    }

    /// Reads a stored receipt through `deduction-extract`, primed for the category's
    /// expected kind of document.
    func extract(path: String, category: DeductionCategory, financialYear: Int) async
        -> DeductionExtractionOutcome
    {
        let response: (status: Int, data: Data)
        do {
            response = try await data.api.invokeRaw(
                "deduction-extract",
                body: ExtractBody(path: path, category: category, financialYear: financialYear))
        } catch {
            return DeductionExtractor.readFailure(nil)
        }
        guard (200..<300).contains(response.status) else {
            return DeductionExtractor.readFailure(response.data)
        }
        return DeductionExtractor.read(response.data).map(DeductionExtractionOutcome.read)
            ?? .failed(DeductionExtractor.failedMessage)
    }
}
