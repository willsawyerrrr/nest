import { annualCents } from '@nest/plan'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'

/**
 * Each breakdown's rolled-up annual total in cents, keyed by breakdown id. A
 * generic breakdown sums the annualised amount of its items; a `gift` breakdown
 * takes the household's total planned gift spend (already an annual figure).
 */
export function breakdownAnnualTotals(
  breakdowns: Breakdown[],
  items: BreakdownItem[],
  giftTotalCents: number,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const breakdown of breakdowns) {
    if (breakdown.kind === 'gift') {
      totals.set(breakdown.id, giftTotalCents)
    } else {
      totals.set(
        breakdown.id,
        items
          .filter((item) => item.breakdown_id === breakdown.id)
          .reduce(
            (total, item) =>
              total +
              annualCents(item.amount_cents, item.frequency, item.interval_count ?? undefined),
            0,
          ),
      )
    }
  }
  return totals
}

/**
 * How many items each breakdown owns, keyed by breakdown id. A generic breakdown
 * counts its `breakdown_item` rows; a `gift` breakdown counts its gift budgets.
 * The count, not the total, drives the derived line's existence.
 */
export function breakdownItemCounts(
  breakdowns: Breakdown[],
  items: BreakdownItem[],
  giftBudgetCount: number,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const breakdown of breakdowns) {
    counts.set(
      breakdown.id,
      breakdown.kind === 'gift'
        ? giftBudgetCount
        : items.filter((item) => item.breakdown_id === breakdown.id).length,
    )
  }
  return counts
}

/** The budget-line writes needed to bring the derived lines in line with the breakdowns. */
export interface BreakdownLineOps {
  create: BudgetLineInput[]
  update: { id: string; input: BudgetLineInput }[]
  remove: string[]
}

/** Whether a group routes via a savings goal rather than a funding account (the DB CHECK bars a destination). */
function groupRoutesViaGoal(group: Breakdown['line_group']): boolean {
  return group === 'savings' || group === 'investments'
}

/** The derived-line fields a breakdown drives, preserving the line's routing and any goal link. */
function derivedInput(
  breakdown: Breakdown,
  totalCents: number,
  line?: BudgetLine,
): BudgetLineInput {
  // A goal-routed group carries no funding account, so a lingering destination
  // is cleared to keep the DB CHECK satisfied when a breakdown moves to one.
  const destinationAccountId = groupRoutesViaGoal(breakdown.line_group)
    ? null
    : (line?.destination_account_id ?? null)
  return {
    line_group: breakdown.line_group,
    name: breakdown.name,
    amount_cents: totalCents,
    frequency: 'annual',
    interval_count: null,
    goal_id: line?.goal_id ?? null,
    breakdown_id: breakdown.id,
    destination_account_id: destinationAccountId,
  }
}

/**
 * Computes the app-enforced derived-line lifecycle: a breakdown with at least one
 * item owns exactly one derived budget line whose name, group, and amount track
 * the breakdown; a breakdown with no items owns none.
 *
 * - A breakdown with items but no line yields a create.
 * - A breakdown whose line has drifted from its name, group, or rolled-up amount
 *   (or is not annual) yields an update, keeping the line's routing and goal link;
 *   a line under a goal-routed group has its funding account cleared.
 * - A breakdown with no items whose line is empty yields a remove, unless the line
 *   carries a `destination_account_id`, in which case its routing is preserved and
 *   it is left in place.
 */
export function reconcileBreakdownLines(
  breakdowns: Breakdown[],
  totals: Map<string, number>,
  counts: Map<string, number>,
  lines: BudgetLine[],
): BreakdownLineOps {
  const ops: BreakdownLineOps = { create: [], update: [], remove: [] }
  for (const breakdown of breakdowns) {
    const line = lines.find((candidate) => candidate.breakdown_id === breakdown.id)
    const hasItems = (counts.get(breakdown.id) ?? 0) >= 1
    const total = totals.get(breakdown.id) ?? 0
    if (hasItems) {
      if (!line) {
        ops.create.push(derivedInput(breakdown, total))
      } else if (
        line.amount_cents !== total ||
        line.name !== breakdown.name ||
        line.line_group !== breakdown.line_group ||
        line.frequency !== 'annual' ||
        line.interval_count !== null ||
        (groupRoutesViaGoal(breakdown.line_group) && line.destination_account_id !== null)
      ) {
        ops.update.push({ id: line.id, input: derivedInput(breakdown, total, line) })
      }
    } else if (line && !line.destination_account_id) {
      ops.remove.push(line.id)
    }
  }
  return ops
}
