import Foundation
import Observation

/// Loads the household's wishlist and members through the cache, and writes items.
@MainActor @Observable
final class WishlistViewModel {
    private(set) var state: ScreenState<WishlistRows> = .loading
    /// The sort choice, persisted as it changes.
    var sort: WishlistSort {
        didSet { sort.store(in: defaults) }
    }

    private let data: NestData
    private let defaults: UserDefaults

    init(data: NestData = .live, defaults: UserDefaults = .standard) {
        self.data = data
        self.defaults = defaults
        sort = WishlistSort.stored(in: defaults)
    }

    /// Streams the screen's rows until the fresh fetch lands. Call from `.task`.
    func load() async {
        let stream = RowsCombiner.stream(
            initial: WishlistRows(), sources: WishlistRows.sources, data: data)
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

    /// Adds an item (or, with `id`, changes it), then reloads the list.
    func save(_ input: WishlistItemInput, id: String? = nil) async throws {
        if let id {
            try await data.update(WishlistItem.self, values: input, filters: [.eq("id", id)])
        } else {
            guard let household = state.value?.householdID else { throw NestError(.invalidRequest) }
            try await data.insert(
                WishlistItem.self, values: WishlistInsert(householdID: household, input: input))
        }
        await load()
    }

    /// Deletes an item, then reloads the list.
    func remove(id: String) async throws {
        try await data.delete(WishlistItem.self, filters: [.eq("id", id)])
        await load()
    }
}
