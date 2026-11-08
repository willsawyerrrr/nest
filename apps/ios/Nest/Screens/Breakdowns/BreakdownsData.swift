import Foundation

/// Every row the Breakdowns screens read.
struct BreakdownsRows: Codable, Sendable, Equatable {
    var breakdowns: [Breakdown] = []
    var items: [BreakdownItem] = []

    /// The two tables, each ordered by name as the PWA reads them.
    static var sources: [TableSource<BreakdownsRows>] {
        [
            .table(Breakdown.self, order: [Order(column: "name")]) { $0.breakdowns = $1 },
            .table(BreakdownItem.self, order: [Order(column: "name")]) { $0.items = $1 },
        ]
    }

    /// The engine input: the breakdowns' ids and every item, in the shape
    /// `summariseBreakdowns` reads.
    var input: BreakdownsInput {
        BreakdownsInput(breakdownIds: breakdowns.map(\.id), items: items)
    }
}

/// The engine's `BreakdownsInput`. Items encode with their column names.
struct BreakdownsInput: Encodable, Sendable {
    let breakdownIds: [String]
    let items: [BreakdownItem]
}
