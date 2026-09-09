import { annualCents } from '@nest/plan'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import {
  giftTotalsByMember,
  type GiftBudget,
  type GiftDiscretionaryBudget,
  type GiftRecipient,
} from './gifts'

/**
 * The rolled-up annual amounts every derived line reads, resolved per line. A
 * generic breakdown owns one line whose amount is `genericTotalsByBreakdownId`;
 * each gift line (keyed by `is_gift_line`) takes its share from
 * `giftTotalsByMember` (keyed by member id, `null` for external recipients).
 */
export interface DerivedAmountContext {
  /** Each generic breakdown's summed annualised item total, keyed by breakdown id. */
  genericTotalsByBreakdownId: Map<string, number>
  /** The gift spend partitioned by recipient member (`null` = external recipients). */
  giftTotalsByMember: Map<string | null, number>
}

/** The summed annualised total of a generic breakdown's items, in cents. */
function genericTotal(items: BreakdownItem[], breakdownId: string): number {
  return items
    .filter((item) => item.breakdown_id === breakdownId)
    .reduce(
      (total, item) =>
        total + annualCents(item.amount_cents, item.frequency, item.interval_count ?? undefined),
      0,
    )
}

/**
 * Builds the {@link DerivedAmountContext} from the household's breakdowns, generic
 * items, and gift data (including the ad hoc discretionary gift buffer, folded
 * into the external partition). Every derived-line amount — in the Budget,
 * Summary, and Planning tabs — resolves from this one context, so the surfaces
 * never drift. Breakdowns are generic; the gift roll-up reads gift data alone.
 *
 * Every parameter is required: a surface that has no gift data (the Breakdowns
 * tab) passes empty lists and a `null` buffer explicitly, so adding a future
 * roll-up input is a compile error at every call site rather than a silent
 * default — the omission that had Summary and Planning under-reporting the ad hoc
 * gift buffer (WSD-136).
 */
export function derivedAmountContext(
  breakdowns: Breakdown[],
  items: BreakdownItem[],
  giftBudgets: GiftBudget[],
  giftRecipients: GiftRecipient[],
  giftDiscretionaryBudget: GiftDiscretionaryBudget | null,
): DerivedAmountContext {
  const genericTotalsByBreakdownId = new Map<string, number>()
  for (const breakdown of breakdowns) {
    genericTotalsByBreakdownId.set(breakdown.id, genericTotal(items, breakdown.id))
  }
  return {
    genericTotalsByBreakdownId,
    giftTotalsByMember: giftTotalsByMember(giftBudgets, giftRecipients, giftDiscretionaryBudget),
  }
}

/**
 * Each generic breakdown's rolled-up annual total, keyed by breakdown id, for the
 * Breakdowns list, which shows one total per breakdown.
 */
export function breakdownTotalsByBreakdownId(
  breakdowns: Breakdown[],
  context: DerivedAmountContext,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const breakdown of breakdowns) {
    totals.set(breakdown.id, context.genericTotalsByBreakdownId.get(breakdown.id) ?? 0)
  }
  return totals
}
