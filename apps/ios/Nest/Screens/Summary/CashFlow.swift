import Foundation

extension ChartColorKey: Codable {}

/// A flow between two nodes, by index, carrying positive cents.
struct SankeyLink: Codable, Equatable, Sendable {
    let source: Int
    let target: Int
    let value: Int
}

/// The engine's `cashFlowGraph`: Sankey nodes and the links between them.
struct CashFlowGraph: Codable, Equatable, Sendable {
    struct Node: Codable, Equatable, Sendable {
        let name: String
        let color: ChartColorKey
        let valueCents: Int
    }

    let nodes: [Node]
    let links: [SankeyLink]

    /// One screen-reader line per link, e.g. `Available to Needs: $2,000.00`.
    var descriptions: [String] {
        links.map {
            "\(nodes[$0.source].name) to \(nodes[$0.target].name): \(MoneyFormat.cents($0.value))"
        }
    }
}

/// The engine's `cashFlow`: the Summary's graphs on both bases, at group level
/// and drilled into budget lines.
struct CashFlowGraphs: Codable, Equatable, Sendable {
    struct Basis: Codable, Equatable, Sendable {
        let grouped: CashFlowGraph
        let drilled: CashFlowGraph
    }

    let takeHome: Basis
    let gross: Basis
    /// Whether there are budget lines to drill into.
    let hasLines: Bool

    func graph(_ basis: IncomeBasis, drilled: Bool) -> CashFlowGraph {
        let graphs = basis == .gross ? gross : takeHome
        return drilled ? graphs.drilled : graphs.grouped
    }
}

/// How the last column's nodes are ordered within each group.
enum SankeyOrder: String, CaseIterable, Codable, Identifiable, Sendable {
    case input, largest, smallest

    var id: Self { self }
    var title: String {
        switch self {
        case .input: "Default order"
        case .largest: "Largest first"
        case .smallest: "Smallest first"
        }
    }
}

/// The engine's `sankeyLayout` input: a graph at a chart width, in an order.
struct SankeyLayoutInput: Codable, Equatable, Sendable {
    let nodeCount: Int
    let links: [SankeyLink]
    let width: Double
    let order: SankeyOrder

    init(graph: CashFlowGraph, width: Double, order: SankeyOrder) {
        nodeCount = graph.nodes.count
        links = graph.links
        self.width = width
        self.order = order
    }
}

/// The engine's `sankeyLayout`: the chart's frame at a width and its geometry in
/// points, inside the frame's margins.
struct SankeyChartLayout: Codable, Equatable, Sendable {
    struct Frame: Codable, Equatable, Sendable {
        let height: Double
        /// The label room either side of the bars.
        let margin: Double
        /// The most label characters that fit in `margin`.
        let maxChars: Int
        let labelGap: Double
        /// Room above and below the bars for the end labels' second line.
        let verticalMargin: Double
    }

    struct Node: Codable, Equatable, Sendable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
        let column: Int
    }

    struct Link: Codable, Equatable, Sendable {
        let source: Int
        let target: Int
        let value: Int
        let x0: Double
        let x1: Double
        let y0: Double
        let y1: Double
        let thickness: Double
    }

    struct Layout: Codable, Equatable, Sendable {
        let nodes: [Node]
        let links: [Link]
        let columns: Int
    }

    let frame: Frame
    let layout: Layout
}
