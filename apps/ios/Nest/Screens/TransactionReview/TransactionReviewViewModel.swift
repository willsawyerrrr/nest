import Foundation
import Observation

/// What a review does to the transaction's Up category.
enum ReviewCategory: Equatable, Sendable {
    /// Leaves Up's category as it is.
    case unchanged
    /// Sets the child category, or clears it with nil.
    case set(String?)
}

/// How a review ended: saved, or refused with the stable code that picks its copy.
enum ReviewOutcome: Equatable, Sendable {
    case saved
    case failed(code: String?)
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
    /// refused change leaves the transaction unreviewed; `save_failed` means Up
    /// took the category, so the review goes ahead.
    func review(
        transactionID: String, note: String, category: ReviewCategory = .unchanged
    ) async -> ReviewOutcome {
        if case .set(let categoryID) = category {
            do {
                let _: SupabaseAPI.Ignored = try await data.invoke(
                    "up-categorise",
                    body: CategoriseBody(transactionId: transactionID, categoryId: categoryID),
                    invalidating: ["transactions"])
            } catch {
                let code = (error as? NestError)?.upstreamCode
                if code != "save_failed" { return .failed(code: code) }
            }
        }
        do {
            try await data.call(
                "review_transaction",
                params: ReviewParams(transactionId: transactionID, note: note),
                invalidating: ["transactions"])
        } catch {
            return .failed(code: nil)
        }
        await load()
        return .saved
    }

    private struct CategoriseBody: Encodable, Sendable {
        let transactionId: String
        let categoryId: String?

        enum CodingKeys: String, CodingKey {
            case transactionId = "transaction_id"
            case categoryId = "category_id"
        }

        /// Encodes a nil category as an explicit `null`, which clears it on Up.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(transactionId, forKey: .transactionId)
            try container.encode(categoryId, forKey: .categoryId)
        }
    }

    private struct ReviewParams: Encodable, Sendable {
        let transactionId: String
        let note: String

        enum CodingKeys: String, CodingKey {
            case transactionId = "p_transaction_id"
            case note = "p_note"
        }
    }
}
