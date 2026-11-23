import Foundation
import Observation

/// Loads every transaction the signed-in member can see that matches the
/// filters, newest first, a page at a time, with Up's categories, the account
/// directory, the members and the deductions naming a transaction. Reviews save
/// through `NestData.reviewTransaction` and reload the pages already shown.
@MainActor @Observable
final class TransactionListViewModel {
    private(set) var state: ScreenState<TransactionListPresentation> = .loading
    /// Changing the filters starts over at the first page; the screen reloads on each change.
    var filters = TransactionFilters() {
        didSet { if filters != oldValue { pages = 1 } }
    }
    private(set) var isLoadingMore = false
    /// Set when loading an older page failed.
    private(set) var loadMoreError: NestError?

    private let data: NestData
    private let calendar: Calendar
    private var pages = 1
    private var rows: TransactionListRows?

    init(data: NestData = .live, calendar: Calendar = .current) {
        self.data = data
        self.calendar = calendar
    }

    /// Streams the rows for the current filters and loaded pages until the
    /// fresh fetch lands, keeping the shown rows meanwhile. Call from `.task`.
    func load() async {
        if case .loaded(let content, _, _) = state {
            state = .loaded(content, isRefreshing: true, refreshError: nil)
        }
        let limit = pages * TransactionListRows.pageSize
        let stream = RowsCombiner.stream(
            initial: TransactionListRows(),
            sources: TransactionListRows.sources(filters: filters, pages: pages, calendar: calendar),
            data: data)
        do {
            for try await snapshot in stream {
                rows = snapshot.rows
                publish(hasMore: snapshot.rows.transactions.count == limit, isRefreshing: snapshot.isCached)
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

    /// Appends the next older page of matching transactions.
    func loadMore() async {
        guard var current = rows, !isLoadingMore else { return }
        isLoadingMore = true
        loadMoreError = nil
        defer { isLoadingMore = false }
        let pageSize = TransactionListRows.pageSize
        do {
            var page: [LedgerTransaction] = []
            for try await snapshot in data.rows(
                LedgerTransaction.self, filters: filters.query(calendar: calendar),
                order: TransactionListRows.order, limit: pageSize,
                offset: current.transactions.count, cached: false)
            {
                page = snapshot.rows
            }
            let known = Set(current.transactions.map(\.id))
            current.transactions += page.filter { !known.contains($0.id) }
            rows = current
            pages += 1
            publish(hasMore: page.count == pageSize, isRefreshing: false)
        } catch is CancellationError {
            return
        } catch {
            loadMoreError = (NestError.from(error) as? NestError) ?? NestError(.unknown)
        }
    }

    /// Saves a review, reloading the shown pages once it lands.
    func review(
        transactionID: String, note: String, category: ReviewCategory = .unchanged
    ) async -> ReviewOutcome {
        let outcome = await data.reviewTransaction(transactionID, note: note, category: category)
        if outcome == .saved { await load() }
        return outcome
    }

    private func publish(hasMore: Bool, isRefreshing: Bool) {
        guard let rows else { return }
        state = .loaded(
            TransactionListPresentation(rows: rows, hasMore: hasMore, calendar: calendar),
            isRefreshing: isRefreshing, refreshError: nil)
    }
}
