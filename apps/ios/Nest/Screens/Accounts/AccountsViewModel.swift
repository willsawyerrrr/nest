import Foundation
import Observation

/// Loads the accounts the member can see, with the household's members, through the cache.
@MainActor @Observable
final class AccountsViewModel {
    private(set) var state: ScreenState<AccountsRows> = .loading

    private let data: NestData

    init(data: NestData = .live) {
        self.data = data
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: AccountsRows(), sources: AccountsRows.sources, data: data)
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
}
