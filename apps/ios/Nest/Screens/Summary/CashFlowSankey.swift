import SwiftUI

/// The Summary's fortnightly cash-flow card: a Sankey of how income flows to the
/// groups and the leftover buffer on the allocation's income basis, with a switch
/// drilling each group into its budget lines and, once drilled, a picker ordering
/// them.
struct CashFlowSankeyCard: View {
    let graphs: CashFlowGraphs
    let basis: IncomeBasis
    @State private var drilled = false
    @State private var order = SankeyOrder.input

    var body: some View {
        let graph = graphs.graph(basis, drilled: drilled)
        if !graph.links.isEmpty {
            NestCard(padding: NestSpacing.md) {
                VStack(alignment: .leading, spacing: NestSpacing.md) {
                    Text("Fortnightly cash flow").font(NestFont.heading).foregroundStyle(NestColor.text)
                    Text("Follows the income basis chosen above.")
                        .font(NestFont.caption).foregroundStyle(NestColor.dimmedText)
                    if graphs.hasLines {
                        Toggle("Show budget lines", isOn: $drilled)
                            .font(NestFont.small).foregroundStyle(NestColor.text)
                            .tint(NestColor.brand).fixedSize()
                    }
                    if drilled {
                        VStack(alignment: .leading, spacing: NestSpacing.xxs) {
                            Text("Order budget lines").font(NestFont.small.weight(.medium))
                                .foregroundStyle(NestColor.text)
                            Picker("Order budget lines", selection: $order) {
                                ForEach(SankeyOrder.allCases) { Text($0.title).tag($0) }
                            }
                            .pickerStyle(.menu).labelsHidden()
                        }
                    }
                    CashFlowSankeyChart(graph: graph, order: drilled ? order : .input)
                }
            }
        }
    }
}

/// A cash-flow graph drawn as a Sankey on a `Canvas`, from the engine's layout at
/// the chart's width. It fills the width, reserving label room either side, and
/// grows in height with the number of end nodes. VoiceOver reads one element per
/// flow instead of the drawing.
struct CashFlowSankeyChart: View {
    let graph: CashFlowGraph
    let order: SankeyOrder
    var layoutSankey: @Sendable (SankeyLayoutInput) async throws -> SankeyChartLayout =
        ScreenEngine.sankeyLayout

    @State private var width: Double = 0
    @State private var laidOut: (input: SankeyLayoutInput, layout: SankeyChartLayout)?

    /// The minimum height, matching the PWA's loading placeholder.
    private static let placeholderHeight: Double = 240 + 2 * 14
    private var input: SankeyLayoutInput { .init(graph: graph, width: width, order: order) }

    var body: some View {
        let current = laidOut.flatMap { $0.input == input ? $0.layout : nil }
        Group {
            if let current {
                SankeyCanvas(graph: graph, chart: current)
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: laidOut?.layout.frame.height ?? Self.placeholderHeight)
        .onGeometryChange(for: Double.self) { $0.size.width } action: { width = $0 }
        .task(id: input) {
            guard input.width > 0, let layout = try? await layoutSankey(input) else { return }
            laidOut = (input, layout)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Cash flow amounts")
        .accessibilityChildren {
            ForEach(graph.descriptions, id: \.self) { Text($0) }
        }
    }
}

/// `graph` drawn from its laid-out `chart`: translucent ribbons in their source's
/// colour, solid bars, and each bar's name and value beside it.
struct SankeyCanvas: View {
    let graph: CashFlowGraph
    let chart: SankeyChartLayout

    /// Stroke that keeps a flow too small for a full point visible.
    private static let hairline: Double = 0.75
    private static let fontSize: Double = 11

    var body: some View {
        Canvas { context, _ in draw(chart, in: &context) }
    }

    private func draw(_ chart: SankeyChartLayout, in context: inout GraphicsContext) {
        let frame = chart.frame
        context.translateBy(x: frame.margin, y: frame.verticalMargin)
        for link in chart.layout.links {
            let color = graph.nodes[link.source].color.color
            let path = Self.ribbon(link)
            context.fill(path, with: .color(color.opacity(0.35)))
            context.stroke(path, with: .color(color.opacity(0.35)), lineWidth: Self.hairline)
        }
        for (index, box) in chart.layout.nodes.enumerated() {
            let node = graph.nodes[index]
            let rect = CGRect(x: box.x, y: box.y, width: box.width, height: box.height)
            context.fill(Path(rect), with: .color(node.color.color))
            context.stroke(Path(rect), with: .color(node.color.color), lineWidth: Self.hairline)

            let left = box.column == 0
            let point = CGPoint(
                x: left ? box.x - frame.labelGap : box.x + box.width + frame.labelGap,
                y: box.y + box.height / 2)
            label(
                Self.clip(node.name, frame.maxChars), colour: NestColor.text, at: point,
                anchor: left ? .bottomTrailing : .bottomLeading, in: &context)
            label(
                MoneyFormat.cents(node.valueCents), colour: NestColor.dimmedText, at: point,
                anchor: left ? .topTrailing : .topLeading, in: &context)
        }
    }

    /// Draws `text` with a halo in the card's colour, so labels stay legible over ribbons.
    private func label(
        _ text: String, colour: Color, at point: CGPoint, anchor: UnitPoint,
        in context: inout GraphicsContext
    ) {
        let text = context.resolve(Text(text).font(.system(size: Self.fontSize)).foregroundStyle(colour))
        var halo = context
        halo.addFilter(.shadow(color: NestColor.surface, radius: 1.5))
        for _ in 0..<4 { halo.draw(text, at: point, anchor: anchor) }
        context.draw(text, at: point, anchor: anchor)
    }

    /// A ribbon's outline: an S-curve top edge, down its thickness, and the same curve back.
    static func ribbon(_ link: SankeyChartLayout.Link) -> Path {
        let mid = (link.x0 + link.x1) / 2
        let bottom0 = link.y0 + link.thickness
        let bottom1 = link.y1 + link.thickness
        var path = Path()
        path.move(to: CGPoint(x: link.x0, y: link.y0))
        path.addCurve(
            to: CGPoint(x: link.x1, y: link.y1), control1: CGPoint(x: mid, y: link.y0),
            control2: CGPoint(x: mid, y: link.y1))
        path.addLine(to: CGPoint(x: link.x1, y: bottom1))
        path.addCurve(
            to: CGPoint(x: link.x0, y: bottom0), control1: CGPoint(x: mid, y: bottom1),
            control2: CGPoint(x: mid, y: bottom0))
        path.closeSubpath()
        return path
    }

    /// `text`, cut with an ellipsis to fit `maxChars`.
    nonisolated static func clip(_ text: String, _ maxChars: Int) -> String {
        text.count > maxChars ? "\(text.prefix(max(1, maxChars - 1)))…" : text
    }
}

#Preview("Cash flow") {
    let graph = CashFlowGraph(
        nodes: [
            .init(name: "Ada salary", color: .buffer, valueCents: 4_000_00),
            .init(name: "Ben wage", color: .buffer, valueCents: 1_200_00),
            .init(name: "Available", color: .buffer, valueCents: 5_200_00),
            .init(name: "Needs", color: .needs, valueCents: 2_400_00),
            .init(name: "Wants", color: .wants, valueCents: 800_00),
            .init(name: "Savings", color: .savings, valueCents: 1_000_00),
            .init(name: "Buffer", color: .buffer, valueCents: 1_000_00),
        ],
        links: [
            .init(source: 0, target: 2, value: 4_000_00), .init(source: 1, target: 2, value: 1_200_00),
            .init(source: 2, target: 3, value: 2_400_00), .init(source: 2, target: 4, value: 800_00),
            .init(source: 2, target: 5, value: 1_000_00), .init(source: 2, target: 6, value: 1_000_00),
        ])
    CashFlowSankeyCard(
        graphs: .init(
            takeHome: .init(grouped: graph, drilled: graph), gross: .init(grouped: graph, drilled: graph),
            hasLines: true),
        basis: .takeHome
    )
    .padding()
    .background(NestColor.background)
}
