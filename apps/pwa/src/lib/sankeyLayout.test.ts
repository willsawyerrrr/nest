import { describe, expect, it } from 'vitest'
import { ribbonPath, sankeyLayout, type SankeyLinkInput } from './sankeyLayout'

const options = { width: 400, height: 300, nodeWidth: 8, nodePadding: 20, minLinkThickness: 4 }
const EPS = 1e-6

/** Shortfall: Available (0) + Shortfall (1) feed Needs (2), Wants (3), Discretionary (4). */
const shortfall: SankeyLinkInput[] = [
  { source: 0, target: 2, value: 2238 },
  { source: 1, target: 2, value: 989 },
  { source: 1, target: 3, value: 880 },
  { source: 1, target: 4, value: 694 },
]

describe('sankeyLayout', () => {
  it('spans every column over the full height with the same scale', () => {
    const { nodes, columns } = sankeyLayout(5, shortfall, options)
    expect(columns).toBe(2)
    for (const ids of [
      [0, 1],
      [2, 3, 4],
    ]) {
      expect(nodes[ids[0]!]!.y).toBeCloseTo(0)
      const end = nodes[ids.at(-1)!]!
      expect(end.y + end.height).toBeCloseTo(options.height)
    }
    expect(nodes[0]!.height / 2238).toBeCloseTo(nodes[2]!.height / 3227)
    expect(nodes[1]!.x).toBe(0)
    expect(nodes[2]!.x).toBe(options.width - options.nodeWidth)
  })

  it('keeps every ribbon on its node bars without overlapping its neighbours', () => {
    const { nodes, links } = sankeyLayout(5, shortfall, options)
    for (const link of links) {
      const source = nodes[link.source]!
      const target = nodes[link.target]!
      expect(link.y0).toBeGreaterThanOrEqual(source.y - EPS)
      expect(link.y0 + link.thickness).toBeLessThanOrEqual(source.y + source.height + EPS)
      expect(link.y1).toBeGreaterThanOrEqual(target.y - EPS)
      expect(link.y1 + link.thickness).toBeLessThanOrEqual(target.y + target.height + EPS)
      expect(link.y1 + link.thickness).toBeLessThanOrEqual(options.height + EPS)
    }
    const out = links.filter((link) => link.source === 1).sort((a, b) => a.y0 - b.y0)
    expect(out.map((link) => link.target)).toEqual([2, 3, 4])
    out.slice(1).forEach((link, i) => {
      expect(link.y0).toBeCloseTo(out[i]!.y0 + out[i]!.thickness)
    })
  })

  it('lets a node fill exactly when its flows balance', () => {
    const { nodes, links } = sankeyLayout(5, shortfall, options)
    const into = links.filter((link) => link.target === 2)
    expect(into.reduce((sum, link) => sum + link.thickness, 0)).toBeCloseTo(nodes[2]!.height)
  })

  it('draws a tiny link at the minimum thickness and still fits the height', () => {
    const { nodes, links } = sankeyLayout(
      3,
      [
        { source: 0, target: 1, value: 100_000 },
        { source: 0, target: 2, value: 1 },
      ],
      options,
    )
    expect(links[1]!.thickness).toBeGreaterThanOrEqual(3.5)
    const end = nodes[2]!
    expect(end.y + end.height).toBeLessThanOrEqual(options.height + EPS)
    expect(links[1]!.value).toBe(1)
  })

  it('centres a lone node and places flow-through nodes in the middle column', () => {
    const { nodes, columns } = sankeyLayout(
      4,
      [
        { source: 0, target: 1, value: 10 },
        { source: 1, target: 2, value: 6 },
        { source: 0, target: 3, value: 4 },
      ],
      options,
    )
    expect(columns).toBe(3)
    expect(nodes.map((node) => node.column)).toEqual([0, 1, 2, 2])
    expect(nodes[0]!.y + nodes[0]!.height / 2).toBeCloseTo(options.height / 2)
  })

  it('orders ribbons by the vertical position of their far end to avoid crossings', () => {
    const { links } = sankeyLayout(
      4,
      [
        { source: 0, target: 3, value: 10 },
        { source: 0, target: 2, value: 10 },
        { source: 1, target: 2, value: 10 },
        { source: 1, target: 3, value: 10 },
      ],
      options,
    )
    const [toLow, toHigh] = [links[0]!, links[1]!]
    expect(toHigh.y0).toBeLessThan(toLow.y0)
  })
})

describe('ribbonPath', () => {
  it('closes an S-curve ribbon of the given thickness', () => {
    const path = ribbonPath({
      source: 0,
      target: 1,
      value: 1,
      x0: 0,
      x1: 100,
      y0: 10,
      y1: 50,
      thickness: 20,
    })
    expect(path).toBe('M0,10 C50,10 50,50 100,50 L100,70 C50,70 50,30 0,30 Z')
  })
})
