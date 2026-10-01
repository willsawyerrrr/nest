import { useElementSize } from '@mantine/hooks'
import { Sankey, Tooltip, type SankeyLinkProps, type SankeyNodeProps } from 'recharts'
import type { CashFlowGraph, CashFlowNode } from '../lib/cashFlow'
import { formatCents } from '../lib/money'

interface CashFlowSankeyChartProps {
  graph: CashFlowGraph
}

/** Width reserved right of the last layer for its labels. */
const LABEL_MARGIN = 92
const ROW_HEIGHT = 28
const MIN_HEIGHT = 240

/** A node's recharts payload, carrying the label colour and value from the graph. */
type GraphNode = CashFlowNode

function SankeyNodeShape({ x, y, width, height, payload }: SankeyNodeProps) {
  const { name, color, valueCents } = payload as unknown as GraphNode
  const label = {
    fontSize: 11,
    paintOrder: 'stroke',
    stroke: 'var(--mantine-color-body)',
    strokeWidth: 3,
  }
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} style={{ fill: color }} />
      <text
        x={x + width + 6}
        y={y + height / 2}
        dominantBaseline="middle"
        style={{ ...label, fill: 'var(--mantine-color-text)' }}
      >
        <tspan x={x + width + 6} dy="-0.4em">
          {name}
        </tspan>
        <tspan x={x + width + 6} dy="1.2em" style={{ fill: 'var(--mantine-color-dimmed)' }}>
          {formatCents(valueCents)}
        </tspan>
      </text>
    </g>
  )
}

function SankeyLinkShape({
  sourceX,
  targetX,
  sourceY,
  targetY,
  sourceControlX,
  targetControlX,
  linkWidth,
  payload,
}: SankeyLinkProps) {
  const y1 = sourceY + linkWidth / 2
  const y2 = targetY + linkWidth / 2
  return (
    <path
      d={`M${sourceX},${y1} C${sourceControlX},${y1} ${targetControlX},${y2} ${targetX},${y2}`}
      fill="none"
      strokeWidth={linkWidth}
      style={{ stroke: (payload.source as unknown as GraphNode).color, strokeOpacity: 0.35 }}
    />
  )
}

/**
 * The cash-flow Sankey's recharts graphic, isolated behind a lazy boundary so the
 * charting library stays out of the default-route bundle. It fills its container's
 * width, reserving a right margin for the last layer's labels so nothing scrolls
 * horizontally at phone width.
 */
export default function CashFlowSankeyChart({ graph }: CashFlowSankeyChartProps) {
  const { ref, width } = useElementSize()
  const sinks = graph.nodes.filter(
    (_, index) => !graph.links.some((link) => link.source === index),
  ).length
  const height = Math.max(MIN_HEIGHT, sinks * ROW_HEIGHT)

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && (
        <Sankey
          width={width}
          height={height}
          data={graph}
          sort={false}
          nodePadding={14}
          nodeWidth={8}
          margin={{ top: 8, right: LABEL_MARGIN, bottom: 8, left: 4 }}
          node={SankeyNodeShape}
          link={SankeyLinkShape}
        >
          <Tooltip
            formatter={(value) => formatCents(Number(value))}
            contentStyle={{
              background: 'var(--mantine-color-body)',
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-sm)',
            }}
            itemStyle={{ color: 'var(--mantine-color-text)' }}
          />
        </Sankey>
      )}
    </div>
  )
}
