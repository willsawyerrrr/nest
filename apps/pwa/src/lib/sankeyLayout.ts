/** A flow between two nodes, by index, carrying a positive value. */
export interface SankeyLinkInput {
  source: number
  target: number
  value: number
}

export interface SankeyLayoutOptions {
  width: number
  height: number
  nodeWidth: number
  /** The least vertical gap between neighbouring nodes in a column. */
  nodePadding: number
  /** The least visible thickness of any link, in pixels. */
  minLinkThickness: number
}

/** A node's bar, in pixels. `column` 0 is the sources' column. */
export interface SankeyNodeLayout {
  x: number
  y: number
  width: number
  height: number
  column: number
}

/** A link's ribbon: its endpoints' top edges and thickness, in pixels. */
export interface SankeyLinkLayout {
  source: number
  target: number
  value: number
  x0: number
  x1: number
  y0: number
  y1: number
  thickness: number
}

export interface SankeyLayout {
  nodes: SankeyNodeLayout[]
  links: SankeyLinkLayout[]
  columns: number
}

const FIT_ITERATIONS = 8

/**
 * Lays a flow graph out in columns of node bars joined by ribbons.
 *
 * - A node's column is its longest distance from a source; nodes with no outflow
 *   sit in the last column.
 * - One scale converts values to pixels for every column. Each column is spread
 *   to span the full height, so all columns share top and bottom edges; a lone
 *   node is centred.
 * - A link thinner than `minLinkThickness` is drawn at that thickness, and the
 *   scale shrinks to keep every column inside `height`. A node is as tall as the
 *   larger of its inflow and outflow ribbons, which stack from its top, so a
 *   ribbon always starts and ends on its node's bar.
 * - Ribbons within a node are ordered by the vertical position of their far end,
 *   which keeps flows from crossing needlessly.
 */
export function sankeyLayout(
  nodeCount: number,
  links: readonly SankeyLinkInput[],
  { width, height, nodeWidth, nodePadding, minLinkThickness }: SankeyLayoutOptions,
): SankeyLayout {
  const outgoing = Array.from({ length: nodeCount }, () => [] as number[])
  links.forEach(({ source }, i) => outgoing[source]!.push(i))

  const depth: number[] = Array<number>(nodeCount).fill(0)
  for (let pass = 0; pass < nodeCount; pass++) {
    for (const { source, target } of links) {
      depth[target] = Math.max(depth[target]!, depth[source]! + 1)
    }
  }
  const last = Math.max(0, ...depth)
  const column = depth.map((d, i) => (outgoing[i]!.length === 0 ? last : d))
  const members = Array.from({ length: last + 1 }, (_, c) =>
    column.flatMap((nodeColumn, i) => (nodeColumn === c ? [i] : [])),
  )

  const fit = (weights: number[]) => {
    const inflow = Array<number>(nodeCount).fill(0)
    const outflow = Array<number>(nodeCount).fill(0)
    links.forEach(({ source, target }, i) => {
      outflow[source]! += weights[i]!
      inflow[target]! += weights[i]!
    })
    const nodeWeights = inflow.map((inValue, i) => Math.max(inValue, outflow[i]!))
    const scale = Math.min(
      ...members.map((ids) => {
        const total = ids.reduce((sum, i) => sum + nodeWeights[i]!, 0)
        return (height - (ids.length - 1) * nodePadding) / total
      }),
    )
    return { nodeWeights, scale }
  }
  let weights = links.map(({ value }) => value)
  let { nodeWeights, scale } = fit(weights)
  for (let round = 0; round < FIT_ITERATIONS; round++) {
    const floor = minLinkThickness / scale
    weights = links.map(({ value }) => Math.max(value, floor))
    ;({ nodeWeights, scale } = fit(weights))
  }

  const nodes: SankeyNodeLayout[] = Array.from({ length: nodeCount }, () => ({
    x: 0,
    y: 0,
    width: nodeWidth,
    height: 0,
    column: 0,
  }))
  const stride = (width - nodeWidth) / Math.max(1, last)
  members.forEach((ids, c) => {
    const heights = ids.map((i) => nodeWeights[i]! * scale)
    const total = heights.reduce((sum, h) => sum + h, 0)
    const gap = ids.length > 1 ? (height - total) / (ids.length - 1) : 0
    let y = ids.length > 1 ? 0 : (height - total) / 2
    ids.forEach((i, k) => {
      nodes[i] = { x: c * stride, y, width: nodeWidth, height: heights[k]!, column: c }
      y += heights[k]! + gap
    })
  })

  const centre = (i: number) => nodes[i]!.y + nodes[i]!.height / 2
  const stack = (side: 'source' | 'target', far: 'target' | 'source'): number[] => {
    const tops = Array<number>(links.length).fill(0)
    const used = Array<number>(nodeCount).fill(0)
    links
      .map((_, i) => i)
      .sort((a, b) => centre(links[a]![far]) - centre(links[b]![far]) || a - b)
      .forEach((i) => {
        const node = links[i]![side]
        tops[i] = nodes[node]!.y + used[node]!
        used[node]! += weights[i]! * scale
      })
    return tops
  }
  const sourceTops = stack('source', 'target')
  const targetTops = stack('target', 'source')

  return {
    nodes,
    columns: last + 1,
    links: links.map(({ source, target, value }, i) => ({
      source,
      target,
      value,
      x0: nodes[source]!.x + nodeWidth,
      x1: nodes[target]!.x,
      y0: sourceTops[i]!,
      y1: targetTops[i]!,
      thickness: weights[i]! * scale,
    })),
  }
}

/** The SVG path of a ribbon: an S-curve top edge, down, and the same curve back. */
export function ribbonPath({ x0, x1, y0, y1, thickness }: SankeyLinkLayout): string {
  const mid = (x0 + x1) / 2
  return (
    `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} ` +
    `L${x1},${y1 + thickness} C${mid},${y1 + thickness} ${mid},${y0 + thickness} ${x0},${y0 + thickness} Z`
  )
}
