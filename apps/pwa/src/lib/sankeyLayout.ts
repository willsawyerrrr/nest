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
  /**
   * Order of the last column's nodes: as supplied (`input`) or largest value first
   * within each group of nodes sharing a source (`amount`). Other columns keep input order.
   */
  order?: 'input' | 'amount'
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

/**
 * Lays a flow graph out in columns of node bars joined by ribbons.
 *
 * - Sources (no inflow) sit in column 0 and nodes with no outflow in the last
 *   column. Every other node sits one column before its nearest target, so nodes
 *   feeding the same column line up whatever feeds them.
 * - One scale converts values to pixels for the whole diagram: a ribbon is
 *   `value * scale` thick at both ends, and a node is `scale` times the larger of
 *   its inflow and outflow, so balanced flows fill a bar exactly. The scale is the
 *   largest that fits the most crowded column in `height` once its padding is
 *   taken out (a column's padding shrinks if it would take more than half the
 *   height); no thickness is ever enlarged, so a tiny flow is a hairline.
 * - A column of several nodes is spread to span the full height, so such columns
 *   share top and bottom edges and only the gaps between nodes differ. A lone node
 *   top-aligns with the highest node it feeds (clamped within the height), or is
 *   centred when it feeds nothing.
 * - With `order: 'amount'`, the last column's nodes are grouped by the source of their
 *   incoming link and each group lists its nodes largest value first (ties keep input
 *   order). Groups keep their input order and stay contiguous; every other column
 *   keeps input order.
 * - Ribbons stack from their node's top, so a ribbon always starts and ends on
 *   its node's bar.
 * - Ribbons within a node are ordered by the vertical position of their far end,
 *   which keeps flows from crossing needlessly.
 */
export function sankeyLayout(
  nodeCount: number,
  links: readonly SankeyLinkInput[],
  { width, height, nodeWidth, nodePadding, order = 'input' }: SankeyLayoutOptions,
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
  const hasInflow = Array<boolean>(nodeCount).fill(false)
  for (const { target } of links) hasInflow[target] = true
  const column = depth.map((d, i) =>
    outgoing[i]!.length === 0 ? last : hasInflow[i] ? last - 1 : d,
  )
  for (let pass = 0; pass < nodeCount; pass++) {
    for (const { source, target } of links) {
      if (hasInflow[source]) column[source] = Math.min(column[source]!, column[target]! - 1)
    }
  }
  const members = Array.from({ length: last + 1 }, (_, c) =>
    column.flatMap((nodeColumn, i) => (nodeColumn === c ? [i] : [])),
  )

  const inflow = Array<number>(nodeCount).fill(0)
  const outflow = Array<number>(nodeCount).fill(0)
  for (const { source, target, value } of links) {
    outflow[source]! += value
    inflow[target]! += value
  }
  const nodeValues = inflow.map((inValue, i) => Math.max(inValue, outflow[i]!))
  if (order === 'amount') {
    const group = (i: number) => links.find(({ target }) => target === i)?.source ?? i
    const firstSeen = new Map<number, number>()
    members[last]!.forEach((i, k) => {
      if (!firstSeen.has(group(i))) firstSeen.set(group(i), k)
    })
    members[last]!.sort(
      (a, b) =>
        firstSeen.get(group(a))! - firstSeen.get(group(b))! || nodeValues[b]! - nodeValues[a]!,
    )
  }
  const padding = (ids: number[]) =>
    ids.length > 1 ? Math.min(nodePadding, height / 2 / (ids.length - 1)) : 0
  const scale = Math.min(
    ...members.map((ids) => {
      const total = ids.reduce((sum, i) => sum + nodeValues[i]!, 0)
      return (height - (ids.length - 1) * padding(ids)) / total
    }),
  )

  const nodes: SankeyNodeLayout[] = Array.from({ length: nodeCount }, () => ({
    x: 0,
    y: 0,
    width: nodeWidth,
    height: 0,
    column: 0,
  }))
  const stride = (width - nodeWidth) / Math.max(1, last)
  const place = (ids: number[], c: number) => {
    const heights = ids.map((i) => nodeValues[i]! * scale)
    const total = heights.reduce((sum, h) => sum + h, 0)
    const gap = ids.length > 1 ? (height - total) / (ids.length - 1) : 0
    let y = (height - total) / 2
    if (ids.length > 1) y = 0
    else if (outgoing[ids[0]!]!.length > 0) {
      const top = Math.min(...outgoing[ids[0]!]!.map((l) => nodes[links[l]!.target]!.y))
      y = Math.min(top, height - total)
    }
    ids.forEach((i, k) => {
      nodes[i] = { x: c * stride, y, width: nodeWidth, height: heights[k]!, column: c }
      y += heights[k]! + gap
    })
  }
  // Lone nodes follow the nodes they feed, so place the later columns first.
  for (let c = last; c >= 0; c--) if (members[c]!.length > 1) place(members[c]!, c)
  for (let c = last; c >= 0; c--) if (members[c]!.length <= 1) place(members[c]!, c)

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
        used[node]! += links[i]!.value * scale
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
      thickness: value * scale,
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
