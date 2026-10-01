import { fortnightlyCents, isTemporaryActive, type BudgetSummary } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import type { DerivedAmountContext } from './breakdowns'
import { applyBreakdownAmounts } from './derivedBudget'
import { formatCents } from './money'
import { chartColors } from './tokens'

/** The basis the cash flow starts from: take-home available cash, or gross income. */
export type IncomeBasis = 'take-home' | 'gross'

/** A budget group's key in a `BudgetSummary`. */
export type GroupKey = keyof BudgetSummary['groups']

/** The six budget groups in reconciliation order, each with its human label. */
export const GROUP_ORDER: { key: GroupKey; label: string }[] = [
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

/** A Sankey node: its label, colour token, and the cents flowing through it. */
export interface CashFlowNode {
  name: string
  color: string
  valueCents: number
}

/** A Sankey link between two node indices, carrying positive cents. */
export interface CashFlowLink {
  source: number
  target: number
  value: number
}

export interface CashFlowGraph {
  nodes: CashFlowNode[]
  links: CashFlowLink[]
}

/**
 * The fortnightly figure of every budget line and active temporary item,
 * computed exactly as the reconciliation sums them, so each group's lines add up
 * to its `BudgetSummary` total.
 */
export function cashFlowLines(
  budgetLines: BudgetLine[],
  temporaryItems: TemporaryItem[],
  context: DerivedAmountContext,
  now: Date,
): CashFlowLine[] {
  return [
    ...applyBreakdownAmounts(budgetLines, context).map((line) => ({
      group: line.line_group,
      name: line.name,
      fortnightlyCents: fortnightlyCents(
        line.amount_cents,
        line.frequency as Parameters<typeof fortnightlyCents>[1],
        line.interval_count ?? undefined,
      ),
    })),
    ...temporaryItems
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
 * The fortnightly cash flow as Sankey nodes and links, reconciling to the
 * `BudgetSummary` ledger: income flows to each non-empty group, then to the
 * leftover Buffer.
 *
 * - `gross` starts at Gross income, which splits into Tax, Salary sacrifice, and
 *   Available; `take-home` starts at Available.
 * - A negative buffer cannot flow, so a Shortfall source feeds the groups for the
 *   part Available cannot cover, filling groups in reconciliation order.
 * - With `lines`, each group fans out to its lines; any part of the group they do
 *   not name flows to an Other node.
 *
 * Zero-valued flows and nodes no flow touches are omitted.
 */
export function cashFlowGraph(
  summary: BudgetSummary,
  mode: IncomeBasis,
  lines: readonly CashFlowLine[] = [],
): CashFlowGraph {
  const nodes: CashFlowNode[] = []
  const links: CashFlowLink[] = []
  const indexByKey = new Map<string, number>()
  const node = (key: string, name: string, color: string): number => {
    let index = indexByKey.get(key)
    if (index === undefined) {
      index = nodes.length
      indexByKey.set(key, index)
      nodes.push({ name, color, valueCents: 0 })
    }
    return index
  }
  const link = (source: number, target: number, value: number): void => {
    if (value > 0) {
      links.push({ source, target, value })
    }
  }

  const available = summary.available.fortnightlyCents
  const { tax, salarySacrifice } = summary
  const availableNode = (): number => node('available', 'Available', chartColors.buffer)

  if (mode === 'gross') {
    const gross = node('gross', 'Gross income', chartColors.buffer)
    link(gross, node('tax', 'Tax', chartColors.tax), tax.fortnightlyCents)
    link(
      gross,
      node('sacrifice', 'Salary sacrifice', chartColors.sacrifice),
      salarySacrifice.fortnightlyCents,
    )
    link(gross, availableNode(), available)
  }

  availableNode()
  let remaining = Math.max(available, 0)
  for (const { key, label } of GROUP_ORDER) {
    const total = summary.groups[key].fortnightlyCents
    if (total <= 0) {
      continue
    }
    const group = node(key, label, chartColors[key])
    const covered = Math.min(remaining, total)
    remaining -= covered
    link(availableNode(), group, covered)
    link(node('shortfall', 'Shortfall', chartColors.tax), group, total - covered)

    const groupLines = lines.filter((line) => line.group === key && line.fortnightlyCents > 0)
    let unnamed = total
    groupLines.forEach((line, i) => {
      link(group, node(`${key}:line:${i}`, line.name, chartColors[key]), line.fortnightlyCents)
      unnamed -= line.fortnightlyCents
    })
    if (groupLines.length > 0) {
      link(group, node(`${key}:other`, 'Other', chartColors[key]), unnamed)
    }
  }
  link(
    availableNode(),
    node('buffer', 'Buffer', chartColors.buffer),
    summary.afterSaving.fortnightlyCents,
  )

  return prune(nodes, links)
}

/**
 * Drops nodes no link touches, renumbers the links, and sets each node's value to
 * the larger of what flows into and out of it.
 */
function prune(nodes: CashFlowNode[], links: CashFlowLink[]): CashFlowGraph {
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
      kept.push({
        ...node,
        valueCents: Math.max(inflow.get(index) ?? 0, outflow.get(index) ?? 0),
      })
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

/** One screen-reader line per link, e.g. `Available to Needs: $2,000.00`. */
export function describeCashFlow({ nodes, links }: CashFlowGraph): string[] {
  return links.map(
    ({ source, target, value }) =>
      `${nodes[source]!.name} to ${nodes[target]!.name}: ${formatCents(value)}`,
  )
}
