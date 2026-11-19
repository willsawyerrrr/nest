import Foundation
import Testing

@testable import Nest

/// Holds the native cash-flow Sankey to the PWA's: `cash-flow-parity.json`
/// carries households' rows, the graphs the PWA's `cashFlowGraph` draws from
/// them with their screen-reader lines, and the frame and geometry
/// `CashFlowSankeyChart` lays out at a width and order. The screen's own input
/// (`SummaryRows.input`) and graphs feed the bundled engine, and the results must
/// equal them.
@Suite struct CashFlowParityTests {
    struct Fixture: Decodable, Sendable {
        struct LayoutCase: Decodable, Sendable {
            var graph: String
            var width: Double
            var order: SankeyOrder
            var expected: EngineParityTests.JSONValue
        }

        var name: String
        var now: String
        var rows: SummaryRows
        var cashFlow: EngineParityTests.JSONValue
        var descriptions: [[String]]
        var layouts: [LayoutCase]
    }

    private final class BundleLocator {}

    private static let fixtures: [Fixture] = {
        let url = Bundle(for: BundleLocator.self).url(
            forResource: "cash-flow-parity", withExtension: "json")!
        return try! JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
    }()

    private static func graph(_ key: String, in graphs: CashFlowGraphs) -> CashFlowGraph {
        let parts = key.split(separator: ".")
        return graphs.graph(parts[0] == "gross" ? .gross : .takeHome, drilled: parts[1] == "drilled")
    }

    @Test func screenAssemblyMatchesThePWAGraphs() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let input = fixture.rows.input(now: ISO8601DateFormatter().date(from: fixture.now)!)
            let output = try await engine.call(.cashFlow, json: JSONEncoder().encode(input))
            #expect(
                try JSONDecoder().decode(EngineParityTests.JSONValue.self, from: output)
                    == fixture.cashFlow, "\(fixture.name)")
        }
    }

    @Test func describesEveryFlowAsThePWADoes() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let graphs = try await engine.cashFlow(
                fixture.rows.input(now: ISO8601DateFormatter().date(from: fixture.now)!))
            let all = [
                graphs.takeHome.grouped, graphs.takeHome.drilled, graphs.gross.grouped,
                graphs.gross.drilled,
            ]
            #expect(all.map(\.descriptions) == fixture.descriptions, "\(fixture.name)")
        }
    }

    @Test func laysOutTheGeometryThePWADraws() async throws {
        let engine = try Engine(bundle: Bundle(for: Engine.self))
        for fixture in Self.fixtures {
            let graphs = try await engine.cashFlow(
                fixture.rows.input(now: ISO8601DateFormatter().date(from: fixture.now)!))
            for layout in fixture.layouts {
                let input = SankeyLayoutInput(
                    graph: Self.graph(layout.graph, in: graphs), width: layout.width, order: layout.order)
                let output = try await engine.call(.sankeyLayout, json: JSONEncoder().encode(input))
                #expect(
                    try JSONDecoder().decode(EngineParityTests.JSONValue.self, from: output)
                        == layout.expected, "\(fixture.name): \(layout.graph) \(layout.order)")
                // The typed layout decodes, as the chart reads it.
                _ = try JSONDecoder().decode(SankeyChartLayout.self, from: output)
            }
        }
    }

    @Test func clipsLabelsToTheirMargin() {
        #expect(CashFlowSankeyChart.clip("Salary sacrifice", 8) == "Salary …")
        #expect(CashFlowSankeyChart.clip("Tax", 8) == "Tax")
    }
}
