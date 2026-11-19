import { useElementSize } from '@mantine/hooks'
import type { CashFlowGraph } from '../lib/cashFlow'
import { formatCents } from '../lib/money'
import {
  LABEL_GAP,
  ribbonPath,
  sankeyFrame,
  sankeyLayout,
  VERTICAL_MARGIN,
  type SankeyOrder,
} from '../lib/sankeyLayout'

interface CashFlowSankeyChartProps {
  graph: CashFlowGraph
  /** Node order within each column. */
  order?: SankeyOrder
}

/** Stroke that keeps a flow too small for a full pixel visible without changing its geometry. */
const HAIRLINE = 0.75
const FONT_SIZE = 11

/** `text`, cut with an ellipsis to fit `maxChars`. */
function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text
}

/**
 * The cash-flow Sankey, drawn as plain SVG from `sankeyLayout` and isolated behind
 * a lazy boundary. It fills its container's width, reserving a margin either side
 * for the first and last columns' labels so nothing scrolls horizontally at phone
 * width; the height grows with the tallest column so labels stay clear of each
 * other.
 */
export default function CashFlowSankeyChart({ graph, order = 'input' }: CashFlowSankeyChartProps) {
  const { ref, width } = useElementSize()
  const { height, margin, maxChars, options } = sankeyFrame(
    graph.nodes.length,
    graph.links,
    width,
    order,
  )
  const layout = sankeyLayout(graph.nodes.length, graph.links, options)

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: 'block', overflow: 'hidden' }}>
          <g transform={`translate(${margin},${VERTICAL_MARGIN})`}>
            {layout.links.map((link) => {
              const source = graph.nodes[link.source]!
              const target = graph.nodes[link.target]!
              return (
                <path
                  key={`${link.source}-${link.target}`}
                  d={ribbonPath(link)}
                  style={{
                    fill: source.color,
                    fillOpacity: 0.35,
                    stroke: source.color,
                    strokeOpacity: 0.35,
                    strokeWidth: HAIRLINE,
                  }}
                >
                  <title>{`${source.name} to ${target.name}: ${formatCents(link.value)}`}</title>
                </path>
              )
            })}
            {layout.nodes.map((box, index) => {
              const { name, color, valueCents } = graph.nodes[index]!
              const left = box.column === 0
              const x = left ? box.x - LABEL_GAP : box.x + box.width + LABEL_GAP
              const y = box.y + box.height / 2
              return (
                <g key={index}>
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    style={{ fill: color, stroke: color, strokeWidth: HAIRLINE }}
                  />
                  <text
                    x={x}
                    y={y}
                    textAnchor={left ? 'end' : 'start'}
                    style={{
                      fontSize: FONT_SIZE,
                      paintOrder: 'stroke',
                      stroke: 'var(--mantine-color-body)',
                      strokeWidth: 4,
                    }}
                  >
                    <tspan x={x} dy="-0.2em" style={{ fill: 'var(--mantine-color-text)' }}>
                      {clip(name, maxChars)}
                    </tspan>
                    <tspan x={x} dy="1.2em" style={{ fill: 'var(--mantine-color-dimmed)' }}>
                      {formatCents(valueCents)}
                    </tspan>
                    <title>{`${name}: ${formatCents(valueCents)}`}</title>
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      )}
    </div>
  )
}
