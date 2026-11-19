import Foundation

/// One confirmed trade to save, with the document it was read from.
struct TradeFromDocument: Equatable, Sendable {
    /// The id minted for the document when it was picked.
    let documentID: String
    /// Where the document was uploaded.
    let path: String
    /// The id minted for the draft, so a retried save does not duplicate it.
    let id: String
    let input: TradeInput
}

/// Storing, reading and saving trade documents, the native counterpart of the PWA's
/// `useTradeDocuments`. Documents live in the private `receipts` bucket as
/// `<household_id>/<document_id>/<uuid>-<file>`, so the first path segment gates access
/// to the owning household.
protocol TradeDocumentsServicing: Sendable {
    /// Stores a prepared document under `documentID` without a `trade_document` row (one
    /// is written with the first trade confirmed from it) and returns where it landed.
    func upload(household: String, documentID: String, file: UploadRules.PreparedFile)
        async throws -> String
    /// Deletes an uploaded object no trade references. Best effort.
    func discard(path: String) async
    /// Reads an uploaded document through `trade-extract`; `financialYear` resolves a
    /// yearless date.
    func extract(path: String, financialYear: Int) async -> TradeExtractionOutcome
    /// Writes one confirmed trade and its document in one transaction
    /// (`create_trades_with_document`), reusing the document's row for later trades.
    func save(_ trade: TradeFromDocument, household: String) async throws
}

struct TradeDocumentsService: TradeDocumentsServicing {
    static let bucket = "receipts"
    var data: NestData = .live

    private struct ExtractBody: Encodable, Sendable {
        let path: String
        let financialYear: Int
    }

    /// A `p_trades` element: the input plus the id minted for its draft.
    private struct TradeRow: Encodable, Sendable {
        let id: String
        let input: TradeInput

        private enum Keys: String, CodingKey { case id }

        func encode(to encoder: any Encoder) throws {
            try input.encode(to: encoder)
            var container = encoder.container(keyedBy: Keys.self)
            try container.encode(id, forKey: .id)
        }
    }

    private struct SaveParams: Encodable, Sendable {
        let householdID: String
        let documentID: String
        let documentPath: String
        let trades: [TradeRow]

        enum CodingKeys: String, CodingKey {
            case householdID = "p_household_id"
            case documentID = "p_document_id"
            case documentPath = "p_document_path"
            case trades = "p_trades"
        }
    }

    func upload(household: String, documentID: String, file: UploadRules.PreparedFile)
        async throws -> String
    {
        let path = UploadRules.objectPath(household: household, record: documentID, name: file.name)
        try await data.api.upload(
            bucket: Self.bucket, path: path, data: file.data,
            contentType: UploadRules.storedContentType(file.name))
        return path
    }

    func discard(path: String) async {
        try? await data.api.remove(bucket: Self.bucket, paths: [path])
    }

    func extract(path: String, financialYear: Int) async -> TradeExtractionOutcome {
        let response: (status: Int, data: Data)
        do {
            response = try await data.api.invokeRaw(
                "trade-extract", body: ExtractBody(path: path, financialYear: financialYear))
        } catch {
            return TradeExtractionReader.readFailure(nil)
        }
        guard (200..<300).contains(response.status) else {
            return TradeExtractionReader.readFailure(response.data)
        }
        return TradeExtractionReader.readExtraction(response.data).map(TradeExtractionOutcome.read)
            ?? .failed(message: TradeExtractionReader.failedMessage)
    }

    func save(_ trade: TradeFromDocument, household: String) async throws {
        try await data.call(
            "create_trades_with_document",
            params: SaveParams(
                householdID: household, documentID: trade.documentID, documentPath: trade.path,
                trades: [TradeRow(id: trade.id, input: trade.input)]),
            invalidating: ["trade", "trade_document"])
    }
}
