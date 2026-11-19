import {
  summariseHouseholdFromRows,
  toIncomeInput,
  type BudgetLineRow,
  type BudgetSummaryBundle,
  type InflowRow,
  type MemberAllowanceRow,
  type TemporaryItemRow,
} from '@nest/household'
import {
  fortnightlyCents,
  isActiveOn,
  isDrawnFromAllowance,
  isTemporaryActive,
  summariseAllowances,
  type BudgetSummary,
  type Frequency,
  type MemberAllowance,
} from '@nest/plan'
import { annualGrossCents } from '@nest/tax'
import {
  LABEL_GAP,
  sankeyFrame,
  sankeyLayout,
  VERTICAL_MARGIN,
  type SankeyLinkInput,
  type SankeyOrder,
} from './sankeyLayout.ts'

/** The basis the cash flow starts from: take-home available cash, or gross income. */
export type IncomeBasis = 'take-home' | 'gross'

/** A budget group's key in a `BudgetSummary`. */
export type GroupKey = keyof BudgetSummary['groups']

/** A node's chart colour token, as the design systems name them. */
export type ChartColorKey = GroupKey | 'buffer' | 'tax' | 'sacrifice'

/** The six budget groups in reconciliation order, each with its human label. */
const GROUP_ORDER: { key: GroupKey; label: string }[] = [
  { key: 'needs', label: 'Needs' },
  { key: 'wants', label: 'Wants' },
  { key: 'discretionary', label: 'Discretionary' },
  { key: 'temporary', label: 'Temporary' },
  { key: 'savings', label: 'Savings' },
  { key: 'investments', label: 'Investments' },
]

/** One budget line (or active temporary item) with its fortnightly amount, for the drill-down. */
export interface CashFlowLine {
  group: GroupKey
  name: string
  fortnightlyCents: number
}

/** One recurring inflow landing now, at its gross fortnightly amount. */
export interface InflowSource {
  id: string
  name: string
  taxable: boolean
  fortnightlyCents: number
}

/** A Sankey node: its label, colour token, and the cents flowing through it. */
export interface CashFlowNode {
  name: string
  color: ChartColorKey
  valueCents: number
}

export interface CashFlowGraph {
  nodes: CashFlowNode[]
  links: SankeyLinkInput[]
}

type Named = { name: string }

/** The rows the cash flow reads: the Summary bundle, with the names its nodes carry. */
export interface CashFlowBundle extends BudgetSummaryBundle {
  inflows: readonly (InflowRow & Named & { id: string })[]
  budgetLines: readonly (BudgetLineRow & Named)[]
  memberAllowances: readonly MemberAllowanceRow[]
  temporaryItems: readonly (TemporaryItemRow & Named)[]
  members: readonly (BudgetSummaryBundle['members'][number] & Named)[]
}

/**
 * The recurring inflows landing at `now`, each at its full gross fortnightly
 * amount. A one-off is left out, as it is of `available`.
 */
export function inflowSources(inflows: CashFlowBundle['inflows'], now: Date): InflowSource[] {
  return inflows
    .filter(
      (inflow) =>
        inflow.paid_on == null &&
        isActiveOn({ startsOn: inflow.starts_on, endsOn: inflow.ends_on }, now),
    )
    .map((inflow) => ({
      id: inflow.id,
      name: inflow.name,
      taxable: inflow.taxable,
      fortnightlyCents: fortnightlyCents(annualGrossCents(toIncomeInput(inflow)), 'annual'),
    }))
}

/**
 * The fortnightly figure of every budget line and active temporary item, read as
 * stored (a derived line's annual amount is canonical in the row). A line drawn
 * from a member's allowance is left out and the allowance appears in its place as
 * a Discretionary line, for what it costs the household.
 */
export function cashFlowLines(bundle: CashFlowBundle, now: Date): CashFlowLine[] {
  const allowances = bundle.memberAllowances.flatMap((row) => {
    const member = bundle.members.find((candidate) => candidate.id === row.member_id)
    if (!member) return []
    const allowance: MemberAllowance & Named = {
      memberId: row.member_id,
      amountCents: row.amount_cents,
      frequency: row.frequency as Frequency,
      ...(row.interval_count != null && { interval: row.interval_count }),
      name: `${member.name}’s allowance`,
    }
    return [allowance]
  })
  const drawable = bundle.budgetLines.map((line) => ({
    amountCents: line.amount_cents,
    frequency: line.frequency as Frequency,
    ...(line.interval_count != null && { interval: line.interval_count }),
    allowanceMemberId: line.allowance_member_id ?? null,
  }))
  return [
    ...bundle.budgetLines
      .filter(
        (line) =>
          !isDrawnFromAllowance(
            { allowanceMemberId: line.allowance_member_id ?? null },
            allowances,
          ),
      )
      .map((line) => ({
        group: line.line_group as GroupKey,
        name: line.name,
        fortnightlyCents: fortnightlyCents(
          line.amount_cents,
          line.frequency as Frequency,
          line.interval_count ?? undefined,
        ),
      })),
    ...summariseAllowances(drawable, allowances).map((summary) => ({
      group: 'discretionary' as const,
      name: allowances.find((allowance) => allowance.memberId === summary.memberId)!.name,
      fortnightlyCents: summary.allowance.fortnightlyCents,
    })),
    ...bundle.temporaryItems
      .filter((item) =>
        isTemporaryActive(
          { contributionCents: item.contribution_cents, targetDate: item.target_date },
          now,
        ),
      )
      .map((item) => ({
        group: 'temporary' as const,
        name: item.name,
        fortnightlyCents: item.contribution_cents,
      })),
  ]
}

/**
 * Splits `total` cents across `weights` in proportion, the largest fractional
 * remainders taking the leftover cents so the parts sum to `total` exactly.
 */
function apportion(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const exact = weights.map((weight) => (total * weight) / weightSum)
  const parts = exact.map(Math.floor)
  let leftover = total - parts.reduce((sum, part) => sum + part, 0)
  exact
    .map((value, i) => ({ i, fraction: value - parts[i]! }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i)
    .forEach(({ i }) => {
      if (leftover > 0) {
        parts[i]! += 1
        leftover -= 1
      }
    })
  return parts
}

/**
 * The fortnightly cash flow as Sankey nodes and links, reconciling to the
 * `BudgetSummary` ledger: income flows to each non-empty group, then to the
 * leftover Buffer.
 *
 * - `gross` starts at Gross income, which splits into Tax, Salary sacrifice, and
 *   Available; `take-home` starts at Available.
 * - A negative buffer cannot flow, so a Shortfall source feeds the groups for the
 *   part Available cannot cover, filling groups in reconciliation order.
 * - With `sources`, each inflow is its own source node feeding Gross income
 *   (`gross`) or Available (`take-home`). A non-taxable inflow carries its own
 *   amount; the rest of the basis is divided across the taxable inflows in
 *   proportion to their gross fortnightly amounts. Basis left over once no
 *   taxable inflow remains flows from an Other income node.
 * - With `lines`, each group fans out to its lines; any part of the group they do
 *   not name flows to an Other node.
 *
 * Zero-valued flows and nodes no flow touches are omitted.
 */
export function cashFlowGraph(
  summary: BudgetSummary,
  mode: IncomeBasis,
  lines: readonly CashFlowLine[] = [],
  sources: readonly InflowSource[] = [],
): CashFlowGraph {
  const nodes: CashFlowNode[] = []
  const links: SankeyLinkInput[] = []
  const indexByKey = new Map<string, number>()
  const node = (key: string, name: string, color: ChartColorKey): number => {
    let index = indexByKey.get(key)
    if (index === undefined) {
      index = nodes.length
      indexByKey.set(key, index)
      nodes.push({ name, color, valueCents: 0 })
    }
    return index
  }
  const link = (source: number, target: number, value: number): void => {
    if (value > 0) links.push({ source, target, value })
  }

  const available = summary.available.fortnightlyCents
  const { tax, salarySacrifice } = summary
  const availableNode = (): number => node('available', 'Available', 'buffer')
  const incomeNode = (): number =>
    mode === 'gross' ? node('gross', 'Gross income', 'buffer') : availableNode()

  if (sources.length > 0) {
    const nonTaxable = sources.filter((source) => !source.taxable)
    const taxable = sources.filter((source) => source.taxable && source.fortnightlyCents > 0)
    const basis =
      available + (mode === 'gross' ? tax.fortnightlyCents + salarySacrifice.fortnightlyCents : 0)
    const pool = Math.max(basis - nonTaxable.reduce((sum, s) => sum + s.fortnightlyCents, 0), 0)
    for (const source of nonTaxable) {
      link(
        node(`inflow:${source.id}`, source.name, 'buffer'),
        incomeNode(),
        source.fortnightlyCents,
      )
    }
    if (taxable.length === 0) {
      link(node('other-income', 'Other income', 'buffer'), incomeNode(), pool)
    } else {
      apportion(
        pool,
        taxable.map((source) => source.fortnightlyCents),
      ).forEach((share, i) => {
        const source = taxable[i]!
        link(node(`inflow:${source.id}`, source.name, 'buffer'), incomeNode(), share)
      })
    }
  }

  if (mode === 'gross') {
    const gross = incomeNode()
    link(gross, node('tax', 'Tax', 'tax'), tax.fortnightlyCents)
    link(
      gross,
      node('sacrifice', 'Salary sacrifice', 'sacrifice'),
      salarySacrifice.fortnightlyCents,
    )
    link(gross, availableNode(), available)
  }

  availableNode()
  let remaining = Math.max(available, 0)
  for (const { key, label } of GROUP_ORDER) {
    const total = summary.groups[key].fortnightlyCents
    if (total <= 0) continue
    const group = node(key, label, key)
    const covered = Math.min(remaining, total)
    remaining -= covered
    link(availableNode(), group, covered)
    link(node('shortfall', 'Shortfall', 'tax'), group, total - covered)

    const groupLines = lines.filter((line) => line.group === key && line.fortnightlyCents > 0)
    let unnamed = total
    groupLines.forEach((line, i) => {
      link(group, node(`${key}:line:${i}`, line.name, key), line.fortnightlyCents)
      unnamed -= line.fortnightlyCents
    })
    if (groupLines.length > 0) link(group, node(`${key}:other`, 'Other', key), unnamed)
  }
  link(availableNode(), node('buffer', 'Buffer', 'buffer'), summary.afterSaving.fortnightlyCents)

  return prune(nodes, links)
}

/**
 * Drops nodes no link touches, renumbers the links, and sets each node's value to
 * the larger of what flows into and out of it.
 */
function prune(nodes: CashFlowNode[], links: SankeyLinkInput[]): CashFlowGraph {
  const inflow = new Map<number, number>()
  const outflow = new Map<number, number>()
  for (const { source, target, value } of links) {
    outflow.set(source, (outflow.get(source) ?? 0) + value)
    inflow.set(target, (inflow.get(target) ?? 0) + value)
  }
  const renumbered = new Map<number, number>()
  const kept: CashFlowNode[] = []
  nodes.forEach((node, index) => {
    if (outflow.has(index) || inflow.has(index)) {
      renumbered.set(index, kept.length)
      kept.push({ ...node, valueCents: Math.max(inflow.get(index) ?? 0, outflow.get(index) ?? 0) })
    }
  })
  return {
    nodes: kept,
    links: links.map(({ source, target, value }) => ({
      source: renumbered.get(source)!,
      target: renumbered.get(target)!,
      value,
    })),
  }
}

/** The input of {@link cashFlowOf}: the Summary's rows and the instant they are read at. */
export interface CashFlowInput {
  bundle: CashFlowBundle
  /** ISO 8601 instant. */
  now: string
}

/** One basis's graphs: at group level, and drilled into budget lines. */
export interface CashFlowBasisGraphs {
  grouped: CashFlowGraph
  drilled: CashFlowGraph
}

/**
 * The Summary's cash-flow graphs on both bases, at group level and drilled into
 * budget lines, from the inflows landing now. `hasLines` says whether there are
 * any lines to drill into.
 */
export function cashFlowOf({ bundle, now }: CashFlowInput) {
  const at = new Date(now)
  const summary = summariseHouseholdFromRows(bundle, at)
  const lines = cashFlowLines(bundle, at)
  const sources = inflowSources(bundle.inflows, at)
  const basis = (mode: IncomeBasis): CashFlowBasisGraphs => ({
    grouped: cashFlowGraph(summary, mode, [], sources),
    drilled: cashFlowGraph(summary, mode, lines, sources),
  })
  return { takeHome: basis('take-home'), gross: basis('gross'), hasLines: lines.length > 0 }
}

/** The input of {@link layoutSankey}: a graph's node count and links, the chart's width, and the order. */
export interface SankeyLayoutInput {
  nodeCount: number
  links: SankeyLinkInput[]
  width: number
  order?: SankeyOrder
}

/** A Sankey graph's frame at `width` and its layout in pixels within it. */
export function layoutSankey({ nodeCount, links, width, order = 'input' }: SankeyLayoutInput) {
  const { height, margin, maxChars, options } = sankeyFrame(nodeCount, links, width, order)
  return {
    frame: { height, margin, maxChars, labelGap: LABEL_GAP, verticalMargin: VERTICAL_MARGIN },
    layout: sankeyLayout(nodeCount, links, options),
  }
}
