import { annualCents, fortnightlyCents, type Frequency } from '@nest/plan'

/** A breakdown item as the roll-up reads it. */
export interface BreakdownItemInput {
  id: string
  breakdown_id: string
  amount_cents: number
  frequency: Frequency
  interval_count: number | null
}

/** The input of {@link summariseBreakdowns}: the breakdowns' ids and every item. */
export interface BreakdownsInput {
  breakdownIds: string[]
  items: BreakdownItemInput[]
}

/** One breakdown's rolled-up total, in cents. */
export interface BreakdownTotal {
  breakdownId: string
  annualCents: number
  fortnightlyCents: number
}

/** One item's fortnightly figure, in cents. */
export interface ItemFortnightly {
  itemId: string
  fortnightlyCents: number
}

/**
 * Each breakdown's rolled-up annual and fortnightly totals, and each item's
 * fortnightly figure: the summed annualised items, then drawn per fortnight, as
 * the PWA's Breakdowns screens show them.
 */
export function summariseBreakdowns(input: BreakdownsInput) {
  const totals: BreakdownTotal[] = input.breakdownIds.map((breakdownId) => {
    const annual = input.items
      .filter((item) => item.breakdown_id === breakdownId)
      .reduce(
        (total, item) =>
          total + annualCents(item.amount_cents, item.frequency, item.interval_count ?? undefined),
        0,
      )
    return {
      breakdownId,
      annualCents: annual,
      fortnightlyCents: fortnightlyCents(annual, 'annual'),
    }
  })
  const items: ItemFortnightly[] = input.items.map((item) => ({
    itemId: item.id,
    fortnightlyCents: fortnightlyCents(
      item.amount_cents,
      item.frequency,
      item.interval_count ?? undefined,
    ),
  }))
  return { totals, items }
}
