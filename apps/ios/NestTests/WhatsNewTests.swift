import Foundation
import Testing

@testable import Nest

private enum Fixture {
    static let json = """
        {"configured":true,"available":[],"implemented":[\
        {"type":"feat","scope":"ios","description":"Goals are now native","date":"2026-11-10T03:00:00Z","sha":"b"},\
        {"type":"fix","scope":null,"description":"Fix a bug","date":"2026-02-28T23:30:00Z","sha":"a"},\
        {"type":"perf","scope":null,"description":"Faster","date":"2026-01-02T00:00:00Z","sha":"c"}],\
        "inProgress":[{"type":"feat","scope":null,"description":"Wishlist","number":7,"url":"https://x/7"}]}
        """

    static let changelog = try! JSONDecoder().decode(Changelog.self, from: Data(json.utf8))
}

@Suite struct ChangelogDecodingTests {
    @Test func decodesEntriesKeepingTheServerOrder() {
        #expect(Fixture.changelog.implemented.map(\.sha) == ["b", "a", "c"])
        #expect(Fixture.changelog.inProgress.map(\.number) == [7])
        #expect(Fixture.changelog.implemented[0].scope == "ios")
    }

    @Test func missingAvailableDecodesEmpty() throws {
        let body = #"{"configured":false,"implemented":[],"inProgress":[]}"#
        let changelog = try JSONDecoder().decode(Changelog.self, from: Data(body.utf8))
        #expect(!changelog.configured)
        #expect(changelog.available.isEmpty)
    }
}

@Suite struct AppVersionTests {
    @Test func comparesNumericallyNotLexically() {
        #expect(AppVersion("0.9.0")! < AppVersion("0.13.0")!)
        #expect(AppVersion("1.0")! == AppVersion("1.0.0")!)
        #expect(AppVersion("1.2.4")! > AppVersion("1.2.3")!)
    }

    @Test func ignoresSuffixesAndRejectsNonVersions() {
        #expect(AppVersion("1.2.3-beta") == AppVersion("1.2.3"))
        #expect(AppVersion("beta") == nil)
        #expect(AppVersion("") == nil)
    }

    @Test func offersOnlyANewerVersion() {
        let latest = LatestRelease(version: "0.13.0", url: nil)
        #expect(UpdateOffer.make(current: "0.12.0", latest: latest, channel: .homebrew)?.version == "0.13.0")
        #expect(UpdateOffer.make(current: "0.13.0", latest: latest, channel: .homebrew) == nil)
        #expect(UpdateOffer.make(current: "1.0.0", latest: latest, channel: .homebrew) == nil)
        #expect(UpdateOffer.make(current: "0.1.0", latest: nil, channel: .homebrew) == nil)
        #expect(UpdateOffer.make(current: "x", latest: latest, channel: .homebrew) == nil)
    }

    @Test func parsesAnAppStoreLookup() throws {
        let body = #"{"resultCount":1,"results":[{"version":"2.1","trackViewUrl":"https://apps.apple.com/app/id1"}]}"#
        let release = try UpdateChannel.parseAppStore(Data(body.utf8))
        #expect(release == LatestRelease(version: "2.1", url: URL(string: "https://apps.apple.com/app/id1")))
        #expect(try UpdateChannel.parseAppStore(Data(#"{"results":[]}"#.utf8)) == nil)
    }

    @Test func parsesACaskVersion() {
        let cask = "cask \"nest\" do\n  version \"0.13.0\"\n  sha256 \"x\"\nend\n"
        #expect(UpdateChannel.parseCask(cask) == LatestRelease(version: "0.13.0", url: nil))
        #expect(UpdateChannel.parseCask("nothing") == nil)
    }

    @Test func looksUpTheChannelThroughTheInjectedFetch() async throws {
        let cask = try await UpdateChannel.homebrew.latest { _ in Data("version \"3.0.0\"".utf8) }
        #expect(cask?.version == "3.0.0")
        let store = try await UpdateChannel.appStore.latest(bundleID: "dev.example") { url in
            #expect(url.absoluteString == "https://itunes.apple.com/lookup?bundleId=dev.example")
            return Data(#"{"results":[{"version":"4.0"}]}"#.utf8)
        }
        #expect(store == LatestRelease(version: "4.0", url: nil))
    }
}

@Suite struct WhatsNewPresentationTests {
    private func presentation(update: UpdateOffer? = nil) -> WhatsNewPresentation {
        WhatsNewPresentation(content: WhatsNewContent(changelog: Fixture.changelog, update: update))
    }

    @Test func rowsCarryEmojiAndDatesInOrder() {
        let rows = presentation().implemented
        #expect(rows.map(\.emoji) == ["🚀", "🛠️", "⚡"])
        #expect(rows.map(\.emojiLabel) == ["Feature", "Fix", "Improvement"])
        #expect(rows.map(\.date) == ["10 Nov 2026", "28 Feb 2026", "2 Jan 2026"])
    }

    @Test func inProgressRowsHaveNoDate() {
        let rows = presentation().inProgress
        #expect(rows.map(\.description) == ["Wishlist"])
        #expect(rows[0].date == nil)
    }

    @Test func updateCopyFollowsTheChannel() {
        let store = presentation(
            update: UpdateOffer(version: "2.0", url: URL(string: "https://apps.apple.com/a"), channel: .appStore))
        #expect(store.updateMessage == "Version 2.0 is available on the App Store.")
        #expect(store.updateLink == URL(string: "https://apps.apple.com/a"))
        #expect(store.upgradeCommand == nil)

        let brew = presentation(update: UpdateOffer(version: "2.0", url: nil, channel: .homebrew))
        #expect(brew.upgradeCommand == "brew upgrade --cask willsawyerrrr/tap/nest")
        #expect(brew.updateLink == nil)
        #expect(presentation().updateMessage == nil)
    }

    @Test func unknownTypesGetNoEmoji() {
        let entry = ImplementedEntry(type: "docs", scope: nil, description: "d", date: "2026-01-01", sha: "z")
        let changelog = Changelog(configured: true, implemented: [entry], inProgress: [])
        let rows = WhatsNewPresentation(content: WhatsNewContent(changelog: changelog, update: nil)).implemented
        #expect(rows[0].emoji == nil)
    }
}

@MainActor
@Suite struct WhatsNewViewModelTests {
    private struct Boom: Error {}

    private func version(latest: String?, fails: Bool = false) -> VersionSource {
        VersionSource(
            current: "0.1.0", channel: .homebrew,
            latest: {
                if fails { throw Boom() }
                return latest.map { LatestRelease(version: $0, url: nil) }
            })
    }

    @Test func loadsChangelogAndOffersANewerVersion() async {
        let model = WhatsNewViewModel(
            changelog: ChangelogSource { Fixture.changelog }, version: version(latest: "0.2.0"))
        await model.load()
        #expect(model.state.value?.changelog == Fixture.changelog)
        #expect(model.state.value?.update?.version == "0.2.0")
    }

    @Test func aFailedVersionCheckOnlyHidesTheOffer() async {
        let model = WhatsNewViewModel(
            changelog: ChangelogSource { Fixture.changelog }, version: version(latest: nil, fails: true))
        await model.load()
        #expect(model.state.value?.changelog == Fixture.changelog)
        #expect(model.state.value?.update == nil)
    }

    @Test func aFailedChangelogFails() async {
        let model = WhatsNewViewModel(
            changelog: ChangelogSource { throw NestError(.server) }, version: version(latest: nil))
        await model.load()
        guard case .failed(let error) = model.state else {
            Issue.record("not failed")
            return
        }
        #expect(error == NestError(.server))
    }

    @Test func aFailedRefreshKeepsTheShownChangelog() async {
        let calls = Counter()
        let model = WhatsNewViewModel(
            changelog: ChangelogSource {
                if calls.next() > 1 { throw NestError(.offline) }
                return Fixture.changelog
            }, version: version(latest: nil))
        await model.load()
        await model.load()
        guard case .loaded(let content, _, let refreshError) = model.state else {
            Issue.record("not loaded")
            return
        }
        #expect(content.changelog == Fixture.changelog)
        #expect(refreshError == NestError(.offline))
    }
}

private final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func next() -> Int { lock.withLock { count += 1; return count } }
}
