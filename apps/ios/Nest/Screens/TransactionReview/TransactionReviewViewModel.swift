import Foundation
import Observation

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
}
