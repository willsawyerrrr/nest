import Foundation
import Observation

/// What the What's new screen renders once loaded.
struct WhatsNewContent: Equatable, Sendable {
    let changelog: Changelog
    let update: UpdateOffer?
}

/// Loads the changelog and checks for a newer version of the app.
@MainActor @Observable
final class WhatsNewViewModel {
    private(set) var state: ScreenState<WhatsNewContent> = .loading

    private let changelog: ChangelogSource
    private let version: VersionSource

    init(changelog: ChangelogSource = .live, version: VersionSource = .live) {
        self.changelog = changelog
        self.version = version
    }

    /// Loads both; a failed changelog fails the screen, a failed version check
    /// only hides the update offer. Call from `.task`.
    func load() async {
        async let offer = version.offer()
        do {
            let loaded = try await changelog.load()
            state = .loaded(
                WhatsNewContent(changelog: loaded, update: await offer), isRefreshing: false,
                refreshError: nil)
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
}
