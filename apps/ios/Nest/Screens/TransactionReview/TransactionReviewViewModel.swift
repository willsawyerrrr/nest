import Foundation
import Observation

/// A transaction a bulk action could not save, with the code that picks its copy.
struct BulkFailure: Equatable, Sendable {
    let id: String
    let code: String?
}

/// Loads the transactions awaiting the signed-in member's review, the focused
/// one and Up's categories, and saves reviews through `NestData`, reloading
/// after each.
@MainActor @Observable
final class TransactionReviewViewModel {
    private(set) var state: ScreenState<TransactionReviewPresentation> = .loading

    private let data: NestData
    private let focusID: String?

    init(focusID: String? = nil, data: NestData = .live) {
        self.focusID = focusID
        self.data = data
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: TransactionReviewRows(),
            sources: TransactionReviewRows.sources(focusID: focusID), data: data)
        do {
            for try await snapshot in stream {
                state = .loaded(
                    TransactionReviewPresentation(rows: snapshot.rows),
                    isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let content = state.value {
                state = .loaded(content, isRefreshing: false, refreshError: failure)
            } else {
                state = .failed(failure)
            }
        }
    }

    /// Discards the shown state and loads again.
    func retry() async {
        if state.value == nil { state = .loading }
        await load()
    }

    /// Marks a transaction reviewed with `note` (blank clears it), setting its Up
    /// category through `up-categorise` first when `category` changes it. A
    /// failed change leaves the transaction unreviewed. That includes
    /// `save_failed`, where Up took the category but Nest's copy kept the old
    /// one: no later sync corrects it, so the member saves again, which sets the
    /// same category on Up and retries the copy.
    func review(
        transactionID: String, note: String, category: ReviewCategory = .unchanged
    ) async -> ReviewOutcome {
        if case .set(let categoryID) = category {
            do {
                let _: SupabaseAPI.Ignored = try await data.invoke(
                    "up-categorise",
                    body: UpCategoriseBody(transactionId: transactionID, categoryId: categoryID),
                    invalidating: ["transactions"])
            } catch {
                return .failed(code: (error as? NestError)?.upstreamCode)
            }
        }
        do {
            try await data.call(
                "review_transaction",
                params: ReviewTransactionParams(transactionId: transactionID, note: note),
                invalidating: ["transactions"])
        } catch {
            return .failed(code: nil)
        }
        await load()
        return .saved
    }

    /// Marks each transaction reviewed, five at a time, leaving each note as it
    /// is. Returns the ones the database refused, in the order given.
    func reviewMany(_ transactionIDs: [String]) async -> [BulkFailure] {
        let failed = await markReviewed(transactionIDs)
        await load()
        return failed
    }

    /// Sets one Up category on each transaction through `up-categorise`'s batch
    /// form (100 per request), then marks the ones Up and Nest both took
    /// reviewed. A request-wide failure fails its whole batch. Returns the ones
    /// that failed at either step, in the order given.
    func categoriseMany(_ transactionIDs: [String], categoryID: String?) async -> [BulkFailure] {
        var done: [String] = []
        var failed: [BulkFailure] = []
        for start in stride(from: 0, to: transactionIDs.count, by: Self.categoriseBatch) {
            let batch = Array(
                transactionIDs[start..<min(start + Self.categoriseBatch, transactionIDs.count)])
            do {
                let response: BatchResponse = try await data.invoke(
                    "up-categorise",
                    body: BatchCategoriseBody(transactionIds: batch, categoryId: categoryID),
                    invalidating: ["transactions"])
                for id in batch {
                    if let result = response.results.first(where: { $0.transactionId == id }),
                        result.code == nil
                    {
                        done.append(id)
                    } else {
                        let code = response.results.first { $0.transactionId == id }?.code
                        failed.append(BulkFailure(id: id, code: code))
                    }
                }
            } catch {
                let code = (error as? NestError)?.upstreamCode
                failed += batch.map { BulkFailure(id: $0, code: code) }
            }
        }
        failed += await markReviewed(done)
        await load()
        return transactionIDs.compactMap { id in failed.first { $0.id == id } }
    }

    /// The most transactions one `up-categorise` request takes.
    private static let categoriseBatch = 100
    /// The most `review_transaction` calls in flight at once.
    private static let reviewConcurrency = 5

    /// Marks each transaction reviewed, a few at a time, keeping its note.
    private func markReviewed(_ ids: [String]) async -> [BulkFailure] {
        let data = self.data
        var refused = Set<String>()
        for start in stride(from: 0, to: ids.count, by: Self.reviewConcurrency) {
            let chunk = ids[start..<min(start + Self.reviewConcurrency, ids.count)]
            await withTaskGroup(of: String?.self) { group in
                for id in chunk {
                    group.addTask {
                        do {
                            try await data.call(
                                "review_transaction", params: ReviewTransactionParams(transactionId: id),
                                invalidating: ["transactions"])
                            return nil
                        } catch {
                            return id
                        }
                    }
                }
                for await id in group { if let id { refused.insert(id) } }
            }
        }
        return ids.filter(refused.contains).map { BulkFailure(id: $0, code: nil) }
    }

    private struct BatchCategoriseBody: Encodable, Sendable {
        let transactionIds: [String]
        let categoryId: String?

        enum CodingKeys: String, CodingKey {
            case transactionIds = "transaction_ids"
            case categoryId = "category_id"
        }

        /// Encodes a nil category as an explicit `null`, which clears it on Up.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(transactionIds, forKey: .transactionIds)
            try container.encode(categoryId, forKey: .categoryId)
        }
    }

    private struct BatchResponse: Decodable, Sendable {
        struct Item: Decodable, Sendable {
            let transactionId: String
            let code: String?

            enum CodingKeys: String, CodingKey {
                case transactionId = "transaction_id"
                case code
            }
        }
        let results: [Item]
    }
}
