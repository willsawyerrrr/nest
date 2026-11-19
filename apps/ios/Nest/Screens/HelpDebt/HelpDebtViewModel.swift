import Foundation
import Observation

/// Loads the household's members and HELP debts through the cache, and saves a balance.
@MainActor @Observable
final class HelpDebtViewModel {
    private(set) var state: ScreenState<HelpDebtRows> = .loading

    private let data: NestData

    init(data: NestData = .live) {
        self.data = data
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: HelpDebtRows(), sources: HelpDebtRows.sources, data: data)
        do {
            for try await snapshot in stream {
                state = .loaded(snapshot.rows, isRefreshing: snapshot.isCached, refreshError: nil)
            }
        } catch is CancellationError {
            return
        } catch {
            let failure = (NestError.from(error) as? NestError) ?? NestError(.unknown)
            if let rows = state.value {
                state = .loaded(rows, isRefreshing: false, refreshError: failure)
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

    /// Upserts the member's standing balance (keyed by member), then reloads.
    func save(memberID: String, balanceCents: Int) async throws {
        guard let household = state.value?.householdID else { throw NestError(.invalidRequest) }
        try await data.upsert(
            HelpDebt.self,
            values: HelpDebtUpsert(
                householdID: household, memberID: memberID, balanceCents: balanceCents),
            onConflict: HelpDebtUpsert.onConflict)
        await load()
    }
}
