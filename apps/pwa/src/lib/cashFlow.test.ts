import { describe, expect, it } from 'vitest'
import type { BudgetSummary, GroupSummary } from '@nest/plan'
import { cashFlowGraph, describeCashFlow, type CashFlowGraph, type CashFlowLine } from './cashFlow'

const group = (fortnightlyCents: number): GroupSummary => ({
  fortnightlyCents,
  annualCents: fortnightlyCents * 26,
  portion: 0,
})
const amounts = (fortnightlyCents: number) => ({
  fortnightlyCents,
  annualCents: fortnightlyCents * 26,
})

const summary: BudgetSummary = {
  oneOffCents: 0,
  available: amounts(500_000),
  groups: {
    needs: group(200_000),
    wants: group(100_000),
    discretionary: group(50_000),
    temporary: group(25_000),
    savings: group(75_000),
    investments: group(25_000),
  },
  outgoings: amounts(375_000),
  savingsBlock: amounts(100_000),
  afterOutgoing: amounts(125_000),
  afterSaving: amounts(25_000),
  tax: amounts(150_000),
  salarySacrifice: amounts(50_000),
}

/** The cents of the link between two named nodes, or undefined. */
function flow(graph: CashFlowGraph, from: string, to: string): number | undefined {
  return graph.links.find(
    (l) => graph.nodes[l.source]!.name === from && graph.nodes[l.target]!.name === to,
  )?.value
}

describe('cashFlowGraph', () => {
  it('flows take-home Available to every group and the buffer, conserving cents', () => {
    const graph = cashFlowGraph(summary, 'take-home')
    expect(graph.nodes.map((n) => n.name)).toEqual([
      'Available',
      'Needs',
      'Wants',
      'Discretionary',
      'Temporary',
      'Savings',
      'Investments',
      'Buffer',
    ])
    expect(flow(graph, 'Available', 'Needs')).toBe(200_000)
    expect(flow(graph, 'Available', 'Buffer')).toBe(25_000)
    expect(graph.nodes[0]!.valueCents).toBe(500_000)
    const out = graph.links.reduce((sum, l) => sum + l.value, 0)
    expect(out).toBe(500_000)
  })

  it('prepends gross, tax and salary sacrifice on the gross basis', () => {
    const graph = cashFlowGraph(summary, 'gross')
    expect(graph.nodes[0]).toMatchObject({ name: 'Gross income', valueCents: 700_000 })
    expect(flow(graph, 'Gross income', 'Tax')).toBe(150_000)
    expect(flow(graph, 'Gross income', 'Salary sacrifice')).toBe(50_000)
    expect(flow(graph, 'Gross income', 'Available')).toBe(500_000)
    expect(flow(graph, 'Available', 'Needs')).toBe(200_000)
  })

  it('shows a negative buffer as a Shortfall source filling groups in order', () => {
    const over: BudgetSummary = {
      ...summary,
      available: amounts(300_000),
      afterOutgoing: amounts(-75_000),
      afterSaving: amounts(-175_000),
    }
    const graph = cashFlowGraph(over, 'take-home')
    expect(graph.nodes.some((n) => n.name === 'Buffer')).toBe(false)
    expect(flow(graph, 'Available', 'Needs')).toBe(200_000)
    expect(flow(graph, 'Available', 'Wants')).toBe(100_000)
    expect(flow(graph, 'Shortfall', 'Wants')).toBeUndefined()
    expect(flow(graph, 'Shortfall', 'Discretionary')).toBe(50_000)
    const shortfall = graph.nodes.find((n) => n.name === 'Shortfall')!
    expect(shortfall.valueCents).toBe(175_000)
    expect(graph.nodes.find((n) => n.name === 'Available')!.valueCents).toBe(300_000)
  })

  it('draws every group from Shortfall when nothing is available', () => {
    const none: BudgetSummary = {
      ...summary,
      available: amounts(0),
      afterSaving: amounts(-475_000),
    }
    const graph = cashFlowGraph(none, 'take-home')
    expect(graph.nodes.some((n) => n.name === 'Available')).toBe(false)
    expect(flow(graph, 'Shortfall', 'Needs')).toBe(200_000)
  })

  it('omits empty groups and a zero buffer', () => {
    const sparse: BudgetSummary = {
      ...summary,
      groups: { ...summary.groups, wants: group(0), temporary: group(0) },
      afterSaving: amounts(0),
    }
    const names = cashFlowGraph(sparse, 'take-home').nodes.map((n) => n.name)
    expect(names).not.toContain('Wants')
    expect(names).not.toContain('Temporary')
    expect(names).not.toContain('Buffer')
  })

  it('has no flows when there is nothing to allocate', () => {
    const empty: BudgetSummary = {
      ...summary,
      available: amounts(0),
      groups: {
        needs: group(0),
        wants: group(0),
        discretionary: group(0),
        temporary: group(0),
        savings: group(0),
        investments: group(0),
      },
      afterSaving: amounts(0),
      tax: amounts(0),
      salarySacrifice: amounts(0),
    }
    expect(cashFlowGraph(empty, 'gross')).toEqual({ nodes: [], links: [] })
  })

  it('drills a group down to its lines, with Other for the unnamed remainder', () => {
    const lines: CashFlowLine[] = [
      { group: 'needs', name: 'Rent', fortnightlyCents: 150_000 },
      { group: 'needs', name: 'Power', fortnightlyCents: 30_000 },
      { group: 'wants', name: 'Zero', fortnightlyCents: 0 },
      { group: 'savings', name: 'Holiday', fortnightlyCents: 75_000 },
    ]
    const graph = cashFlowGraph(summary, 'take-home', lines)
    expect(flow(graph, 'Needs', 'Rent')).toBe(150_000)
    expect(flow(graph, 'Needs', 'Power')).toBe(30_000)
    expect(flow(graph, 'Needs', 'Other')).toBe(20_000)
    expect(flow(graph, 'Savings', 'Holiday')).toBe(75_000)
    expect(flow(graph, 'Savings', 'Other')).toBeUndefined()
    expect(flow(graph, 'Wants', 'Zero')).toBeUndefined()
    expect(graph.nodes.find((n) => n.name === 'Needs')!.valueCents).toBe(200_000)
  })

  it('never produces a link to a missing node', () => {
    const graph = cashFlowGraph(summary, 'gross', [
      { group: 'needs', name: 'Rent', fortnightlyCents: 1 },
    ])
    for (const l of graph.links) {
      expect(graph.nodes[l.source]).toBeDefined()
      expect(graph.nodes[l.target]).toBeDefined()
    }
  })
})

describe('describeCashFlow', () => {
  it('states each link with formatted cents', () => {
    expect(describeCashFlow(cashFlowGraph(summary, 'take-home'))).toContain(
      'Available to Needs: $2,000.00',
    )
  })
})
