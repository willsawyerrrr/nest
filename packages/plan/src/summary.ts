/**
 * Summary reconciliation: available money against outgoings and money set
 * aside, leaving a buffer. Mirrors the household's spreadsheet Summary.
 */

import type { BudgetGroup, BudgetLine, Money, NonTaxableInflow, TemporaryItem } from './index'
import { annualCents, fortnightlyCents, FORTNIGHTS_PER_YEAR } from './normalize'

/** A figure expressed in both the plan's primary fortnightly period and annually. */
export interface Amounts {
  readonly fortnightlyCents: Money
  readonly annualCents: Money
}

/** A group's totals plus its `portion`: its share of available fortnightly cash. */
export interface GroupSummary extends Amounts {
  readonly portion: number
}

/** The inputs a Summary reconciles. */
export interface SummaryInput {
  readonly afterTaxIncomeAnnualCents: Money
  readonly nonTaxableInflows: readonly NonTaxableInflow[]
  readonly budgetLines: readonly BudgetLine[]
  readonly temporaryItems: readonly TemporaryItem[]
}

/**
 * The reconciled Summary. `available` is after-tax income plus non-taxable
 * inflows; `groups` carries all six groups (Temporary derived from active
 * temporary items only); `outgoings` is Needs + Wants + Discretionary +
 * Temporary; `savingsBlock` is Savings + Investments; `afterOutgoing` and
 * `afterSaving` are the running remainders, the latter being the buffer.
 */
export interface BudgetSummary {
  readonly available: Amounts
  readonly groups: Readonly<Record<BudgetGroup | 'temporary', GroupSummary>>
  readonly outgoings: Amounts
  readonly savingsBlock: Amounts
  readonly afterOutgoing: Amounts
  readonly afterSaving: Amounts
}

/**
 * Whether a temporary item is still an active fortnightly outflow at `now`:
 * active while `now` is at or before the instant of its `targetDate`, expired
 * (and excluded from the buffer) thereafter.
 */
export function isTemporaryActive(item: TemporaryItem, now: Date): boolean {
  return now.getTime() <= Date.parse(item.targetDate)
}

/** Sums two `Amounts` field-wise. */
function addAmounts(a: Amounts, b: Amounts): Amounts {
  return {
    fortnightlyCents: a.fortnightlyCents + b.fortnightlyCents,
    annualCents: a.annualCents + b.annualCents,
  }
}

/**
 * Reconciles a household's plan into fortnightly and annual figures at `now`.
 * Each group total sums its lines' normalized amounts; the Temporary group sums
 * only active temporary items' fortnightly contributions. A group's `portion`
 * is its fortnightly total over available fortnightly cash, guarded to 0 when no
 * cash is available. `now` is taken as a parameter for deterministic results.
 */
export function summarise(input: SummaryInput, now: Date): BudgetSummary {
  const inflowFortnightly = input.nonTaxableInflows.reduce(
    (total, inflow) => total + fortnightlyCents(inflow.amountCents, inflow.frequency),
    0,
  )
  const inflowAnnual = input.nonTaxableInflows.reduce(
    (total, inflow) => total + annualCents(inflow.amountCents, inflow.frequency),
    0,
  )
  const available: Amounts = {
    fortnightlyCents:
      Math.round(input.afterTaxIncomeAnnualCents / FORTNIGHTS_PER_YEAR) + inflowFortnightly,
    annualCents: input.afterTaxIncomeAnnualCents + inflowAnnual,
  }

  const zero: Amounts = { fortnightlyCents: 0, annualCents: 0 }
  const lineTotals: Record<BudgetGroup, Amounts> = {
    needs: zero,
    wants: zero,
    discretionary: zero,
    savings: zero,
    investments: zero,
  }
  for (const line of input.budgetLines) {
    lineTotals[line.group] = addAmounts(lineTotals[line.group], {
      fortnightlyCents: fortnightlyCents(line.amountCents, line.frequency),
      annualCents: annualCents(line.amountCents, line.frequency),
    })
  }

  const temporaryFortnightly = input.temporaryItems.reduce(
    (total, item) => total + (isTemporaryActive(item, now) ? item.contributionCents : 0),
    0,
  )
  const temporary: Amounts = {
    fortnightlyCents: temporaryFortnightly,
    annualCents: temporaryFortnightly * FORTNIGHTS_PER_YEAR,
  }

  const portionOf = (amounts: Amounts): number =>
    available.fortnightlyCents === 0 ? 0 : amounts.fortnightlyCents / available.fortnightlyCents
  const withPortion = (amounts: Amounts): GroupSummary => ({
    ...amounts,
    portion: portionOf(amounts),
  })

  const groups = {
    needs: withPortion(lineTotals.needs),
    wants: withPortion(lineTotals.wants),
    discretionary: withPortion(lineTotals.discretionary),
    temporary: withPortion(temporary),
    savings: withPortion(lineTotals.savings),
    investments: withPortion(lineTotals.investments),
  }

  const outgoings = [
    lineTotals.needs,
    lineTotals.wants,
    lineTotals.discretionary,
    temporary,
  ].reduce(addAmounts, zero)
  const savingsBlock = addAmounts(lineTotals.savings, lineTotals.investments)
  const afterOutgoing: Amounts = {
    fortnightlyCents: available.fortnightlyCents - outgoings.fortnightlyCents,
    annualCents: available.annualCents - outgoings.annualCents,
  }
  const afterSaving: Amounts = {
    fortnightlyCents: afterOutgoing.fortnightlyCents - savingsBlock.fortnightlyCents,
    annualCents: afterOutgoing.annualCents - savingsBlock.annualCents,
  }

  return { available, groups, outgoings, savingsBlock, afterOutgoing, afterSaving }
}
