import AppIntents

/// One budget line, as the intent's line parameter and as a result other
/// shortcuts can use. Resolved from the live `budget-line` response through
/// `BudgetLineEntityQuery`; budget lines are household-wide, so every member
/// sees the same set.
struct BudgetLineEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Budget Line")
    static let defaultQuery = BudgetLineEntityQuery()

    let id: String
    let listing: SpotlightListing

    @Property(title: "Budget line")
    var name: String

    @Property(title: "Planned amount")
    var plannedAmount: Double

    @Property(title: "Cadence")
    var cadence: String

    init(_ line: BudgetLineMatch) {
        id = line.id
        listing = SpotlightListing.budgetLine(line)
        name = line.name
        plannedAmount = Double(line.amountCents) / 100
        cadence = BudgetLinePhrasing.cadence(
            frequency: line.frequency, intervalCount: line.intervalCount
        )
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(listing.summary)")
    }
}

/// Matches a spoken or typed name against budget lines.
enum BudgetLineMatching {
    /// Lower-cases, collapses runs of whitespace, and trims.
    static func normalise(_ value: String) -> String {
        value.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// Lines whose name equals, contains, or is contained by `query`, ignoring
    /// case and spacing: exact matches first, then the shortest names. An empty
    /// query matches nothing.
    static func filter(_ lines: [BudgetLineMatch], matching query: String) -> [BudgetLineMatch] {
        let wanted = normalise(query)
        guard !wanted.isEmpty else { return [] }
        return lines
            .compactMap { line -> (line: BudgetLineMatch, name: String)? in
                let name = normalise(line.name)
                guard !name.isEmpty, name.contains(wanted) || wanted.contains(name) else {
                    return nil
                }
                return (line, name)
            }
            .sorted { lhs, rhs in
                let lhsExact = lhs.name == wanted
                let rhsExact = rhs.name == wanted
                if lhsExact != rhsExact { return lhsExact }
                return lhs.name.count < rhs.name.count
            }
            .map(\.line)
    }
}

/// Offers, resolves, and searches the household's budget lines from the live
/// `budget-line` response. Signed out or unreachable, it offers none.
struct BudgetLineEntityQuery: EntityStringQuery {
    func lines() async -> [BudgetLineMatch] {
        let load = await budgetLineLoad(
            accessToken: { try await supabaseAuth.session.accessToken },
            service: .live
        )
        guard case .lines(let lines) = load else { return [] }
        return lines
    }

    func entities(for identifiers: [String]) async throws -> [BudgetLineEntity] {
        await lines().filter { identifiers.contains($0.id) }.map(BudgetLineEntity.init)
    }

    func entities(matching string: String) async throws -> [BudgetLineEntity] {
        BudgetLineMatching.filter(await lines(), matching: string).map(BudgetLineEntity.init)
    }

    func suggestedEntities() async throws -> [BudgetLineEntity] {
        await lines().map(BudgetLineEntity.init)
    }
}
