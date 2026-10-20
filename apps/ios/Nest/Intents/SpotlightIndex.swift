import AppIntents
import CoreSpotlight

/// What Spotlight is told about one entity: the title, a one-line summary with
/// the planned amount, and the words it should also be found by. Built from
/// plain response values so it is testable without the system.
struct SpotlightListing: Sendable, Equatable {
    let title: String
    let summary: String
    let description: String
    let keywords: [String]

    static func budgetLine(_ line: BudgetLineMatch) -> SpotlightListing {
        let summary = BudgetLinePhrasing.perPeriod(
            amountCents: line.amountCents, frequency: line.frequency, intervalCount: line.intervalCount
        )
        return SpotlightListing(
            title: line.name,
            summary: summary,
            description: "Budgeted \(summary) for \(line.name).",
            keywords: keywords(for: line.name, extra: ["budget", "budget line", "planned spending"])
        )
    }

    static func paySplit(_ account: PaySplitAccount) -> SpotlightListing {
        let summary = "\(BufferPhrasing.currency(account.fortnightlyCents)) per fortnight"
        return SpotlightListing(
            title: account.name,
            summary: summary,
            description: "\(summary) of your pay goes to \(account.name).",
            keywords: keywords(for: account.name, extra: ["pay split", "transfer", "account"])
        )
    }

    /// The name, its words, and the extra terms, without duplicates.
    private static func keywords(for name: String, extra: [String]) -> [String] {
        var seen = Set<String>()
        return ([name] + name.split(whereSeparator: \.isWhitespace).map(String.init) + extra)
            .filter { seen.insert($0.lowercased()).inserted }
    }
}

extension SpotlightListing {
    /// The Core Spotlight attributes for this listing.
    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: .content)
        attributes.contentDescription = description
        attributes.keywords = keywords
        return attributes
    }
}

@available(iOS 18.0, *)
extension BudgetLineEntity: IndexedEntity {
    var attributeSet: CSSearchableItemAttributeSet { listing.attributeSet }
}

@available(iOS 18.0, *)
extension PaySplitEntity: IndexedEntity {
    var attributeSet: CSSearchableItemAttributeSet { listing.attributeSet }
}

/// Keeps the app's Spotlight index in step with the household's budget lines and
/// routed pay-split accounts. Both are planned figures shared by the whole
/// household; no balance or transaction is indexed. Indexing needs iOS 18; on
/// earlier systems both calls do nothing.
actor SpotlightIndexer {
    static let shared = SpotlightIndexer()

    private var refreshing = false

    /// Replaces the indexed entities with the current ones. Signed out or
    /// unreachable, it leaves the index as it is. A refresh already running
    /// covers a second request.
    func refresh() async {
        guard #available(iOS 18.0, *), !refreshing else { return }
        refreshing = true
        defer { refreshing = false }

        let token: @Sendable () async throws -> String = {
            try await supabaseAuth.session.accessToken
        }
        let lines = await budgetLineLoad(accessToken: token, service: .live)
        let splits = await paySplitLoad(accessToken: token, service: .live)
        guard case .lines(let budgetLines) = lines, case .summary(let summary) = splits else { return }

        let index = CSSearchableIndex(name: Self.indexName)
        do {
            try await index.deleteAppEntities(ofType: BudgetLineEntity.self)
            try await index.deleteAppEntities(ofType: PaySplitEntity.self)
            try await index.indexAppEntities(budgetLines.map(BudgetLineEntity.init))
            try await index.indexAppEntities(summary.splits.map(PaySplitEntity.init))
        } catch {
            // Indexing is best effort; the next refresh retries.
        }
    }

    /// Removes every indexed entity, on sign-out.
    func clear() async {
        guard #available(iOS 18.0, *) else { return }
        let index = CSSearchableIndex(name: Self.indexName)
        try? await index.deleteAppEntities(ofType: BudgetLineEntity.self)
        try? await index.deleteAppEntities(ofType: PaySplitEntity.self)
    }

    private static let indexName = "NestEntities"
}
