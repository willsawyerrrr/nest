import { useElementSize } from '@mantine/hooks'
import type { CashFlowGraph } from '../lib/cashFlow'
import { formatCents } from '../lib/money'
import { ribbonPath, sankeyLayout } from '../lib/sankeyLayout'

interface CashFlowSankeyChartProps {
  graph: CashFlowGraph
}

const NODE_WIDTH = 8
const NODE_PADDING = 24
const MIN_LINK_THICKNESS = 4
/** Vertical room one node's two-line label needs, so labels never collide. */
const ROW_HEIGHT = 32
const MIN_HEIGHT = 240
const LABEL_GAP = 6
/** Room above and below the bars for the end labels' second line. */
const VERTICAL_MARGIN = 14
const FONT_SIZE = 11
/** Approximate width of one label character at `FONT_SIZE`. */
const CHAR_WIDTH = 6

/** The label margin each side reserves: the first column's labels sit left, the last column's right. */
function labelMargin(width: number): number {
  return Math.min(140, Math.round(width * 0.27))
}

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
export default function CashFlowSankeyChart({ graph }: CashFlowSankeyChartProps) {
  const { ref, width } = useElementSize()
  const rows = graph.nodes.filter(
    (_, index) => !graph.links.some((link) => link.source === index),
  ).length
  const height = Math.max(MIN_HEIGHT, rows * ROW_HEIGHT) + 2 * VERTICAL_MARGIN
  const margin = labelMargin(width)
  const layout = sankeyLayout(graph.nodes.length, graph.links, {
    width: width - 2 * margin,
    height: height - 2 * VERTICAL_MARGIN,
    nodeWidth: NODE_WIDTH,
    nodePadding: NODE_PADDING,
    minLinkThickness: MIN_LINK_THICKNESS,
  })
  const maxChars = Math.floor((margin - LABEL_GAP) / CHAR_WIDTH)

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
                  style={{ fill: source.color, fillOpacity: 0.35 }}
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
                    style={{ fill: color }}
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
