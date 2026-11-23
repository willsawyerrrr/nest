/**
 * Actual spend beside the planned budget: which fortnight is reconciled, and
 * the per-group totals the `budget_actual_spend` RPC returns folded into one
 * shape every surface reads.
 */

import { MS_PER_DAY } from './constants.ts'
import type { BudgetGroup, Money } from './index.ts'
import { isoDateMs, type PayPeriod } from './payPeriod.ts'

/**
 * The fortnight grid's anchor where the household has confirmed no payday: the
 * epoch the calendar feed steps an unanchored cadence from.
 */
export const PAY_CYCLE_EPOCH = '2020-07-01'

/** Days in one reconciled fortnight. */
const FORTNIGHT_DAYS = 14

/** The inflow fields that place the household's pay cycle. */
export interface PayCycleInflow {
  readonly type: string
  readonly paid_on: string | null
  readonly pay_anchor_date: string | null
}

/**
 * The date the household's fortnights step from: the earliest confirmed payday
 * (`pay_anchor_date`) among its recurring salary and wage inflows, so a
 * fortnight opens on a payday; {@link PAY_CYCLE_EPOCH} where none is confirmed.
 */
export function payCycleAnchor(inflows: readonly PayCycleInflow[]): string {
  const anchors = inflows
    .filter(
      (inflow) =>
        (inflow.type === 'salary' || inflow.type === 'wage') &&
        inflow.paid_on === null &&
        inflow.pay_anchor_date !== null,
    )
    .map((inflow) => inflow.pay_anchor_date as string)
    .sort()
  return anchors[0] ?? PAY_CYCLE_EPOCH
}

/** Formats a UTC-midnight instant as `YYYY-MM-DD`. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The fortnight on the grid stepped from `anchor` that holds `today`, moved
 * `offset` whole fortnights (negative is earlier). Both ends are inclusive
 * local dates; the grid runs both ways from the anchor, so a date before it
 * still falls in exactly one fortnight.
 */
export function spendFortnight(anchor: string, today: string, offset = 0): PayPeriod {
  const anchorMs = isoDateMs(anchor)
  const elapsedDays = Math.round((isoDateMs(today) - anchorMs) / MS_PER_DAY)
  const index = Math.floor(elapsedDays / FORTNIGHT_DAYS) + offset
  const startMs = anchorMs + index * FORTNIGHT_DAYS * MS_PER_DAY
  return {
    periodStart: isoDate(startMs),
    periodEnd: isoDate(startMs + (FORTNIGHT_DAYS - 1) * MS_PER_DAY),
  }
}

/** One row of the `budget_actual_spend` RPC: a group's spend, or spend in no group. */
export interface ActualSpendRow {
  readonly line_group: BudgetGroup | null
  readonly spent_cents: Money
}

/** A period's spend per budget group, plus the spend that counts toward none. */
export interface ActualSpend {
  readonly groups: Record<BudgetGroup, Money>
  readonly unbudgeted: Money
}

/** Folds the RPC's rows into every group's spend (nil where a group has none) and the unbudgeted rest. */
export function actualSpendByGroup(rows: readonly ActualSpendRow[]): ActualSpend {
  const groups: Record<BudgetGroup, Money> = {
    needs: 0,
    wants: 0,
    discretionary: 0,
    savings: 0,
    investments: 0,
  }
  let unbudgeted = 0
  for (const row of rows) {
    if (row.line_group === null) {
      unbudgeted += row.spent_cents
    } else {
      groups[row.line_group] += row.spent_cents
    }
  }
  return { groups, unbudgeted }
}
