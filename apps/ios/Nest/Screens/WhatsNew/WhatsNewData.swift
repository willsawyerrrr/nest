import Foundation

/// A merged change in the `changelog` edge function's response.
struct ImplementedEntry: Decodable, Equatable, Identifiable, Sendable {
    let type: String
    let scope: String?
    let description: String
    /// ISO timestamp the change landed.
    let date: String
    let sha: String

    var id: String { sha }
}

/// An open pull request in the `changelog` edge function's response.
struct InProgressEntry: Decodable, Equatable, Identifiable, Sendable {
    let type: String
    let scope: String?
    let description: String
    let number: Int
    let url: String

    var id: Int { number }
}

/// The `changelog` edge function's response, every list newest first. The
/// function drops entries newer than a build's commit when sent one; the native
/// app sends none, so `available` is empty and the version check decides whether
/// an update exists.
struct Changelog: Decodable, Equatable, Sendable {
    let configured: Bool
    let available: [ImplementedEntry]
    let implemented: [ImplementedEntry]
    let inProgress: [InProgressEntry]

    init(
        configured: Bool, available: [ImplementedEntry] = [], implemented: [ImplementedEntry],
        inProgress: [InProgressEntry]
    ) {
        self.configured = configured
        self.available = available
        self.implemented = implemented
        self.inProgress = inProgress
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        configured = try container.decode(Bool.self, forKey: .configured)
        available = try container.decodeIfPresent([ImplementedEntry].self, forKey: .available) ?? []
        implemented = try container.decode([ImplementedEntry].self, forKey: .implemented)
        inProgress = try container.decode([InProgressEntry].self, forKey: .inProgress)
    }

    private enum CodingKeys: String, CodingKey {
        case configured, available, implemented, inProgress
    }
}

/// Where the changelog comes from, injectable so tests skip the network.
struct ChangelogSource: Sendable {
    var load: @Sendable () async throws -> Changelog

    static let live = ChangelogSource {
        try await NestData.live.api.invoke("changelog")
    }
}
