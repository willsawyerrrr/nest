/**
 * Summary reconciliation: available money against outgoings and money set
 * aside, leaving a buffer. Mirrors the household's spreadsheet Summary.
 */

import type { BudgetGroup, BudgetLine, Money, NonTaxableInflow, TemporaryItem } from './index.ts'
import { annualCents, fortnightlyCents, FORTNIGHTS_PER_YEAR } from './normalize.ts'

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
  /**
   * The annual income tax and levies (including the 15% super contributions
   * tax) that separate gross income from take-home, for the gross-basis view.
   * Absent ⇒ nil.
   */
  readonly taxAnnualCents?: Money
  /**
   * The household's total annual salary sacrifice — the pre-tax amounts
   * sacrificed from pay — for the gross-basis view. Absent ⇒ nil.
   */
  readonly salarySacrificeAnnualCents?: Money
  /**
   * The gross one-off money landing in the financial year — severance, a bonus, a
   * gift — taxable and non-taxable alike. Reported as its own figure and left out
   * of `available`; see {@link BudgetSummary.oneOffCents}. Absent ⇒ nil.
   */
  readonly oneOffCents?: Money
}

/**
 * The reconciled Summary. `available` is after-tax income plus non-taxable
 * inflows; `groups` carries all six groups (Temporary derived from active
 * temporary items only); `outgoings` is Needs + Wants + Discretionary +
 * Temporary; `savingsBlock` is Savings + Investments; `afterOutgoing` and
 * `afterSaving` are the running remainders, the latter being the buffer.
 * `tax` and `salarySacrifice` are the gross-basis-only slices — income tax and
 * levies, and the household's total salary sacrifice (pre-tax amounts sacrificed
 * from pay) — that with `available` sum to the gross income basis
 * (`gross = available + tax + salarySacrifice`); both nil unless the
 * corresponding inputs are supplied.
 */
export interface BudgetSummary {
  /**
   * The year's one-off money — severance, a bonus, a gift — reported beside the
   * plan rather than inside it, and deliberately NOT part of `available`. Every
   * other figure here is fortnightly money the household can count on, and a
   * payment that lands once is not: divided into a fortnightly figure it would
   * raise the buffer for all 26 fortnights of the year on the strength of one, so
   * the plan would spend it twenty-six times over. It is a single annual cents
   * figure for the same reason — there is no honest fortnightly reading of it.
   */
  readonly oneOffCents: Money
  readonly available: Amounts
  readonly groups: Readonly<Record<BudgetGroup | 'temporary', GroupSummary>>
  readonly outgoings: Amounts
  readonly savingsBlock: Amounts
  readonly afterOutgoing: Amounts
  readonly afterSaving: Amounts
  readonly tax: Amounts
  readonly salarySacrifice: Amounts
}

/**
 * An optional effective window, both ends ISO dates (YYYY-MM-DD) and each side
 * open when null or absent.
 */
export interface EffectiveWindow {
  readonly startsOn?: string | null
  readonly endsOn?: string | null
}

/**
 * Whether `now` falls within an effective window — at or after its `startsOn` and
 * at or before its `endsOn`, either side open when unset. The bounds are parsed
 * as UTC midnight, the same instant comparison the buffer uses to expire a
 * temporary item.
 */
export function isActiveOn(window: EffectiveWindow, now: Date): boolean {
  const nowMs = now.getTime()
  return (
    (window.startsOn == null || Date.parse(window.startsOn) <= nowMs) &&
    (window.endsOn == null || nowMs <= Date.parse(window.endsOn))
  )
}

/**
 * Whether a temporary item is still an active fortnightly outflow at `now`:
 * active while `now` is at or before the instant of its `targetDate`, expired
 * (and excluded from the buffer) thereafter.
 */
export function isTemporaryActive(item: TemporaryItem, now: Date): boolean {
  return isActiveOn({ endsOn: item.targetDate }, now)
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
 * One-off money passes straight through to `oneOffCents`, entering no total: it is
 * reported beside the plan rather than spent by it.
 */
export function summarise(input: SummaryInput, now: Date): BudgetSummary {
  // A non-taxable inflow with an effective window counts in full while `now` is
  // within it and not at all otherwise — the steady "what lands each fortnight
  // right now" reading, deliberately not the FY-share proration the tax estimate
  // applies to a taxable inflow.
  const activeInflows = input.nonTaxableInflows.filter((inflow) => isActiveOn(inflow, now))
  const inflowFortnightly = activeInflows.reduce(
    (total, inflow) =>
      total + fortnightlyCents(inflow.amountCents, inflow.frequency, inflow.interval),
    0,
  )
  const inflowAnnual = activeInflows.reduce(
    (total, inflow) => total + annualCents(inflow.amountCents, inflow.frequency, inflow.interval),
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
      fortnightlyCents: fortnightlyCents(line.amountCents, line.frequency, line.interval),
      annualCents: annualCents(line.amountCents, line.frequency, line.interval),
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

  const annualToAmounts = (annual: Money): Amounts => ({
    fortnightlyCents: Math.round(annual / FORTNIGHTS_PER_YEAR),
    annualCents: annual,
  })
  const tax = annualToAmounts(input.taxAnnualCents ?? 0)
  const salarySacrifice = annualToAmounts(input.salarySacrificeAnnualCents ?? 0)

  return {
    oneOffCents: input.oneOffCents ?? 0,
    available,
    groups,
    outgoings,
    savingsBlock,
    afterOutgoing,
    afterSaving,
    tax,
    salarySacrifice,
  }
}
