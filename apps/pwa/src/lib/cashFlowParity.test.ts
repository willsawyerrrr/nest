import { describe, expect, it } from 'vitest'
import { breakdown, breakdownItems, budgetLine, NOW, rows } from '../test/summaryRows'
import { toAssignableAllowances } from './allowances'
import { derivedAmountContext } from './breakdowns'
import {
  cashFlowGraph,
  cashFlowLines,
  describeCashFlow,
  inflowSources,
  type CashFlowGraph,
  type IncomeBasis,
} from './cashFlow'
import {
  LABEL_GAP,
  sankeyFrame,
  sankeyLayout,
  VERTICAL_MARGIN,
  type SankeyOrder,
} from './sankeyLayout'
import { summariseHousehold } from './summary'
import { chartColors } from './tokens'

/**
 * The cash-flow graphs and Sankey geometry the native Summary chart is held to.
 * For each household (`summaryRows`, and the same rows overspent into a
 * Shortfall), the fixture carries the PWA's graphs on both bases, at group level
 * and drilled into budget lines, with their screen-reader lines, and the frame
 * and layout `CashFlowSankeyChart` draws at two widths in every order. The iOS
 * tests run the same rows and graphs through the bundled engine and must return
 * identical graphs and geometry.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/cash-flow-parity.json'

/** The chart colour token whose CSS value the PWA graph carries. */
const colorKey = new Map(Object.entries(chartColors).map(([key, value]) => [value, key]))

const now = new Date(NOW)
const context = derivedAmountContext([breakdown], breakdownItems, [], [], null)

function graphs(household: typeof rows) {
  const summary = summariseHousehold({
    timeZone: 'Australia/Sydney',
    inflows: household.inflows,
    budgetLines: household.budgetLines,
    memberAllowances: household.memberAllowances,
    taxProfiles: household.taxProfiles,
    contributions: household.contributions,
    helpDebts: household.helpDebts,
    deductions: household.deductions,
    members: household.members,
    goals: household.savingsGoals,
    accounts: household.savers.map((account) => ({
      id: account.id ?? '',
      balance_cents: account.balance_cents ?? 0,
      owner_member_id: account.owner_member_id,
    })),
    derivedAmounts: context,
    temporaryItems: household.temporaryItems,
    now,
  })
  const lines = cashFlowLines(
    household.budgetLines,
    household.temporaryItems,
    context,
    now,
    toAssignableAllowances(household.memberAllowances, household.members),
  )
  const sources = inflowSources(household.inflows, now)
  const tokenised = ({ nodes, links }: CashFlowGraph) => ({
    nodes: nodes.map((node) => ({ ...node, color: colorKey.get(node.color)! })),
    links,
  })
  const basis = (mode: IncomeBasis) => ({
    grouped: tokenised(cashFlowGraph(summary, mode, [], sources)),
    drilled: tokenised(cashFlowGraph(summary, mode, lines, sources)),
  })
  const cashFlow = {
    takeHome: basis('take-home'),
    gross: basis('gross'),
    hasLines: lines.length > 0,
  }
  const all = [
    cashFlow.takeHome.grouped,
    cashFlow.takeHome.drilled,
    cashFlow.gross.grouped,
    cashFlow.gross.drilled,
  ]
  return {
    summary,
    cashFlow,
    descriptions: all.map((graph) =>
      describeCashFlow({
        nodes: graph.nodes.map((node) => ({ ...node, color: '' })),
        links: graph.links,
      }),
    ),
  }
}

const overspent: typeof rows = {
  ...rows,
  budgetLines: [
    ...rows.budgetLines,
    budgetLine({ id: 'b7', name: 'Mortgage', amount_cents: 9_000_00, frequency: 'fortnightly' }),
  ],
}

type GraphKey = 'takeHome.grouped' | 'takeHome.drilled' | 'gross.grouped' | 'gross.drilled'

/** The frame and layout the chart draws for `household`'s `graph` at `width` in `order`. */
function layoutCase(
  cashFlow: ReturnType<typeof graphs>['cashFlow'],
  graph: GraphKey,
  width: number,
  order: SankeyOrder,
) {
  const [basis, level] = graph.split('.') as ['takeHome' | 'gross', 'grouped' | 'drilled']
  const { nodes, links } = cashFlow[basis][level]
  const { height, margin, maxChars, options } = sankeyFrame(nodes.length, links, width, order)
  return {
    graph,
    width,
    order,
    expected: {
      frame: { height, margin, maxChars, labelGap: LABEL_GAP, verticalMargin: VERTICAL_MARGIN },
      layout: sankeyLayout(nodes.length, links, options),
    },
  }
}

const PHONE = 358
const WIDE = 700

const households = [
  {
    name: 'a two-member household',
    rows,
    layouts: [
      ['takeHome.grouped', PHONE, 'input'],
      ['gross.drilled', PHONE, 'input'],
      ['gross.drilled', PHONE, 'largest'],
      ['gross.drilled', PHONE, 'smallest'],
      ['takeHome.drilled', WIDE, 'largest'],
    ] as [GraphKey, number, SankeyOrder][],
  },
  {
    name: 'an overspent household',
    rows: overspent,
    layouts: [['takeHome.grouped', PHONE, 'input']] as [GraphKey, number, SankeyOrder][],
  },
].map(({ name, rows: household, layouts }) => {
  const computed = graphs(household)
  return {
    name,
    rows: household,
    ...computed,
    layouts: layouts.map(([graph, width, order]) =>
      layoutCase(computed.cashFlow, graph, width, order),
    ),
  }
})

describe('the native cash-flow parity fixture', () => {
  const text = `${JSON.stringify(
    households.map(({ name, rows: household, cashFlow, descriptions, layouts }) => ({
      name,
      now: NOW,
      rows: household,
      cashFlow,
      descriptions,
      layouts,
    })),
    null,
    2,
  )}\n`

  it('matches the graphs and geometry the PWA Summary draws from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises inflow sources, drilled lines, an allowance and a Shortfall', () => {
    const [funded, short] = households
    const names = (graph: CashFlowGraph) => graph.nodes.map((node) => node.name)
    expect(funded!.summary.afterSaving.fortnightlyCents).toBeGreaterThan(0)
    expect(names(funded!.cashFlow.gross.drilled)).toEqual(
      expect.arrayContaining(['Ada salary', 'Ben wage', 'Tax', 'Ada’s allowance', 'Rent']),
    )
    expect(names(funded!.cashFlow.gross.drilled)).not.toContain('Coffee')
    expect(short!.summary.afterSaving.fortnightlyCents).toBeLessThan(0)
    expect(names(short!.cashFlow.takeHome.grouped)).toContain('Shortfall')
  })
})
