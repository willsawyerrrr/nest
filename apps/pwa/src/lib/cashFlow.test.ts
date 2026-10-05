import { describe, expect, it } from 'vitest'
import type { BudgetSummary, GroupSummary } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import { makeInflow, makeOneOffInflow } from '../test/fixtures'
import {
  cashFlowGraph,
  cashFlowLines,
  describeCashFlow,
  inflowSources,
  type CashFlowGraph,
  type CashFlowLine,
  type InflowSource,
} from './cashFlow'

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
  allowances: [],
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

describe('cashFlowLines', () => {
  const budgetLine: BudgetLine = {
    id: 'l1',
    household_id: 'h',
    line_group: 'wants',
    name: 'Coffee',
    amount_cents: 1_000,
    frequency: 'fortnightly',
    interval_count: null,
    goal_id: null,
    destination_account_id: null,
    breakdown_id: null,
    gift_recipient_member_id: null,
    is_gift_line: false,
    management_url: null,
    allowance_member_id: null,
    created_at: '',
    updated_at: '',
  }
  const item = (name: string, targetDate: string): TemporaryItem => ({
    id: name,
    household_id: 'h',
    name,
    contribution_cents: 5_000,
    target_date: targetDate,
    created_at: '',
    updated_at: '',
  })

  it('lists budget lines and active temporary items, dropping ended ones', () => {
    const lines = cashFlowLines(
      [budgetLine],
      [item('Trip', '2030-01-01'), item('Done', '2020-01-01')],
      { genericTotalsByBreakdownId: new Map(), giftTotalsByMember: new Map() },
      new Date('2026-06-01'),
    )
    expect(lines).toEqual([
      { group: 'wants', name: 'Coffee', fortnightlyCents: 1_000 },
      { group: 'temporary', name: 'Trip', fortnightlyCents: 5_000 },
    ])
  })

  it('shows a member’s allowance in place of the lines drawn from it', () => {
    const lines = cashFlowLines(
      [
        { ...budgetLine, line_group: 'discretionary', name: 'Gym', allowance_member_id: 'ada' },
        { ...budgetLine, line_group: 'discretionary', name: 'Coffee', allowance_member_id: 'ada' },
        { ...budgetLine, id: 'l3', line_group: 'discretionary', name: 'Books' },
      ],
      [],
      { genericTotalsByBreakdownId: new Map(), giftTotalsByMember: new Map() },
      new Date('2026-06-01'),
      [{ memberId: 'ada', amountCents: 50_00, frequency: 'fortnightly', name: 'Ada’s allowance' }],
    )
    expect(lines).toEqual([
      { group: 'discretionary', name: 'Books', fortnightlyCents: 1_000 },
      { group: 'discretionary', name: 'Ada’s allowance', fortnightlyCents: 50_00 },
    ])
  })

  it('counts an overdrawn allowance for what is drawn', () => {
    const lines = cashFlowLines(
      [
        {
          ...budgetLine,
          line_group: 'discretionary',
          amount_cents: 80_00,
          allowance_member_id: 'ada',
        },
      ],
      [],
      { genericTotalsByBreakdownId: new Map(), giftTotalsByMember: new Map() },
      new Date('2026-06-01'),
      [{ memberId: 'ada', amountCents: 50_00, frequency: 'fortnightly', name: 'Ada’s allowance' }],
    )
    expect(lines).toEqual([
      { group: 'discretionary', name: 'Ada’s allowance', fortnightlyCents: 80_00 },
    ])
  })
})

describe('inflowSources', () => {
  const now = new Date('2026-06-01')

  it('reads each recurring inflow at its gross fortnightly amount, whatever its cadence', () => {
    expect(
      inflowSources(
        [
          makeInflow({ id: 'a', name: 'Salary', schedule: 'annual', amount_cents: 130_000_00 }),
          makeInflow({
            id: 'b',
            name: 'Rent',
            taxable: false,
            type: 'other',
            schedule: 'monthly',
            amount_cents: 2_600_00,
          }),
          makeInflow({
            id: 'c',
            name: 'Shifts',
            type: 'wage',
            schedule: 'weekly',
            amount_cents: null,
            hourly_rate_cents: 50_00,
            hours_per_period: 20,
          }),
        ],
        now,
      ),
    ).toEqual([
      { id: 'a', name: 'Salary', taxable: true, fortnightlyCents: 5_000_00 },
      { id: 'b', name: 'Rent', taxable: false, fortnightlyCents: 1_200_00 },
      { id: 'c', name: 'Shifts', taxable: true, fortnightlyCents: 2_000_00 },
    ])
  })

  it('leaves out one-offs and inflows outside their window', () => {
    expect(
      inflowSources(
        [
          makeOneOffInflow(),
          makeInflow({ id: 'old', ends_on: '2026-01-31' }),
          makeInflow({ id: 'future', starts_on: '2026-09-01' }),
          makeInflow({ id: 'now', starts_on: '2026-01-01', ends_on: '2026-12-31' }),
        ],
        now,
      ).map((source) => source.id),
    ).toEqual(['now'])
  })
})

describe('cashFlowGraph with inflow sources', () => {
  const src = (id: string, taxable: boolean, fortnightlyCents: number): InflowSource => ({
    id,
    name: id,
    taxable,
    fortnightlyCents,
  })
  // Gross 700_000 = 500_000 available + 150_000 tax + 50_000 sacrifice.
  const sources = [src('A', true, 300_000), src('B', true, 100_000), src('Rent', false, 50_000)]

  it('feeds Gross income from each inflow, tax falling on taxable inflows pro rata', () => {
    const graph = cashFlowGraph(summary, 'gross', [], sources)
    expect(flow(graph, 'Rent', 'Gross income')).toBe(50_000)
    expect(flow(graph, 'A', 'Gross income')).toBe(487_500)
    expect(flow(graph, 'B', 'Gross income')).toBe(162_500)
    expect(graph.nodes.find((n) => n.name === 'Gross income')!.valueCents).toBe(700_000)
  })

  it('feeds Available from each inflow, splitting take-home pro rata', () => {
    const graph = cashFlowGraph(summary, 'take-home', [], sources)
    expect(flow(graph, 'Rent', 'Available')).toBe(50_000)
    expect(flow(graph, 'A', 'Available')).toBe(337_500)
    expect(flow(graph, 'B', 'Available')).toBe(112_500)
    expect(graph.nodes.find((n) => n.name === 'Gross income')).toBeUndefined()
  })

  it('conserves every cent when the split does not divide evenly', () => {
    const graph = cashFlowGraph(
      summary,
      'take-home',
      [],
      [src('A', true, 1), src('B', true, 1), src('C', true, 1)],
    )
    const into = graph.links
      .filter((l) => graph.nodes[l.target]!.name === 'Available' && l.source !== l.target)
      .map((l) => l.value)
    expect(into.reduce((a, b) => a + b, 0)).toBe(500_000)
    expect(into.sort()).toEqual([166_666, 166_667, 166_667])
  })

  it('draws the whole basis from Other income when no taxable inflow lands', () => {
    const graph = cashFlowGraph(summary, 'take-home', [], [src('Rent', false, 50_000)])
    expect(flow(graph, 'Other income', 'Available')).toBe(450_000)
    expect(flow(graph, 'Rent', 'Available')).toBe(50_000)
  })

  it('ignores a taxable inflow with no gross amount', () => {
    const graph = cashFlowGraph(summary, 'take-home', [], [src('Zero', true, 0)])
    expect(flow(graph, 'Zero', 'Available')).toBeUndefined()
    expect(flow(graph, 'Other income', 'Available')).toBe(500_000)
  })
})
