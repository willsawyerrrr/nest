import Foundation

/// A dotted numeric version (`1.2.3`), compared component by component with
/// missing components read as zero.
struct AppVersion: Comparable, Equatable, Sendable {
    let components: [Int]

    /// `nil` unless every dot-separated component starts with a digit; anything
    /// after a component's digits (`1.2.3-beta`) is ignored.
    init?(_ string: String) {
        let parts = string.split(separator: ".", omittingEmptySubsequences: false)
        let numbers = parts.compactMap { Int($0.prefix(while: \.isNumber)) }
        guard !parts.isEmpty, numbers.count == parts.count else { return nil }
        components = numbers
    }

    static func < (lhs: AppVersion, rhs: AppVersion) -> Bool {
        let count = max(lhs.components.count, rhs.components.count)
        for index in 0..<count {
            let (left, right) = (lhs.component(index), rhs.component(index))
            if left != right { return left < right }
        }
        return false
    }

    static func == (lhs: AppVersion, rhs: AppVersion) -> Bool { !(lhs < rhs) && !(rhs < lhs) }

    private func component(_ index: Int) -> Int {
        index < components.count ? components[index] : 0
    }
}

/// The newest published version of the app on its distribution channel.
struct LatestRelease: Equatable, Sendable {
    let version: String
    /// Where to get it, when the channel has a page for the app.
    let url: URL?
}

/// How the app is distributed, and so where a newer version is looked up.
enum UpdateChannel: Sendable {
    /// iOS and Mac Catalyst.
    case appStore
    /// The native macOS app, installed from the `willsawyerrrr/tap` cask.
    case homebrew

    static var current: UpdateChannel {
        #if os(macOS)
            .homebrew
        #else
            .appStore
        #endif
    }

    /// The command that upgrades the Homebrew install.
    static let upgradeCommand = "brew upgrade --cask willsawyerrrr/tap/nest"

    /// Reads the latest release from the channel, `nil` when none is published.
    func latest(
        bundleID: String = Bundle.main.bundleIdentifier ?? "",
        fetch: @Sendable (URL) async throws -> Data = { try await URLSession.shared.data(from: $0).0 }
    ) async throws -> LatestRelease? {
        switch self {
        case .appStore:
            var components = URLComponents(string: "https://itunes.apple.com/lookup")!
            components.queryItems = [URLQueryItem(name: "bundleId", value: bundleID)]
            return try Self.parseAppStore(try await fetch(components.url!))
        case .homebrew:
            let url = URL(
                string: "https://raw.githubusercontent.com/willsawyerrrr/homebrew-tap/main/Casks/nest.rb")!
            return Self.parseCask(String(decoding: try await fetch(url), as: UTF8.self))
        }
    }

    /// The first result of an iTunes lookup response.
    static func parseAppStore(_ data: Data) throws -> LatestRelease? {
        struct Response: Decodable {
            struct Result: Decodable {
                let version: String
                let trackViewUrl: URL?
            }
            let results: [Result]
        }
        guard let first = try JSONDecoder().decode(Response.self, from: data).results.first else {
            return nil
        }
        return LatestRelease(version: first.version, url: first.trackViewUrl)
    }

    /// The `version "…"` line of a Homebrew cask.
    static func parseCask(_ source: String) -> LatestRelease? {
        guard let match = source.firstMatch(of: /(?m)^\s*version\s+"([^"]+)"/) else { return nil }
        return LatestRelease(version: String(match.1), url: nil)
    }
}

/// A newer version than the one running.
struct UpdateOffer: Equatable, Sendable {
    let version: String
    let url: URL?
    let channel: UpdateChannel

    /// The offer when `latest` is newer than `current`, else `nil`; an
    /// unreadable version on either side offers nothing.
    static func make(current: String, latest: LatestRelease?, channel: UpdateChannel) -> UpdateOffer? {
        guard let latest, let running = AppVersion(current), let newest = AppVersion(latest.version),
            running < newest
        else { return nil }
        return UpdateOffer(version: latest.version, url: latest.url, channel: channel)
    }
}

/// Where the version check reads the running and the latest version, injectable
/// so tests skip the bundle and the network.
struct VersionSource: Sendable {
    var current: String
    var channel: UpdateChannel
    var latest: @Sendable () async throws -> LatestRelease?

    static var live: VersionSource {
        let channel = UpdateChannel.current
        return VersionSource(
            current: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0",
            channel: channel, latest: { try await channel.latest() })
    }

    /// The offer for the latest release; a failed lookup offers nothing.
    func offer() async -> UpdateOffer? {
        let release = try? await latest()
        return UpdateOffer.make(current: current, latest: release, channel: channel)
    }
}
