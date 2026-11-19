import Foundation
import Testing

@testable import Nest

/// Holds the native Budget's search and sort to the PWA: `budget-line-list-parity.json`
/// carries lines and, for each search and sort, the groups and lines `BudgetLineList`
/// lists. The screen's presentation must list the same.
@Suite struct BudgetLineListParityTests {
    struct Listed: Decodable, Equatable {
        let group: BudgetGroup
        let ids: [String]
    }

    struct Case: Decodable {
        let query: String
        let key: BudgetLineSortKey
        let direction: SortDirection
        let groups: [Listed]
    }

    struct Fixture: Decodable {
        let rows: BudgetRows
        let cases: [Case]
    }

    private final class BundleLocator {}

    private static let fixture: Fixture = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "budget-line-list-parity", withExtension: "json")!
        return try! JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }()

    @Test func everySearchAndSortListsWhatThePWALists() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        let rows = Self.fixture.rows
        let now = Date()
        let overview = try await engine.budgetOverview(rows.input(now: now))
        let presentation = BudgetPresentation(
            content: BudgetContent(rows: rows, overview: overview, currentMemberID: nil, now: now))
        for c in Self.fixture.cases {
            let listed = presentation.groups(
                search: c.query, sort: BudgetLineSort(key: c.key, direction: c.direction)
            ).map { Listed(group: $0.group, ids: $0.lines.map(\.id)) }
            #expect(listed == c.groups, "\(c.query) \(c.key) \(c.direction)")
        }
    }
}
