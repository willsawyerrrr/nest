import type { TaxBreakdown } from '@nest/tax'

/**
 * A step's role in the build-up, driving its bar colour: `income` opens with the
 * gross bar, `deduction` a paper reduction to taxable income (returned before the
 * end, since it costs no cash), `super` the concessional contribution diverted to
 * the fund, `tax` a tax component, and `result` the closing take-home bar.
 */
export type WaterfallStepKind = 'income' | 'deduction' | 'super' | 'tax' | 'result'

/**
 * One step of the gross-to-take-home waterfall. `startCents`/`endCents` are the
 * lower and upper bounds of the step's bar on the shared money axis: the income
 * and result bars run from zero to their level, and every other step floats
 * between the running money before and after it. `increase` marks a step that
 * adds back to the running total (the deduction returned as cash) rather than
 * taking from it.
 */
export interface WaterfallStep {
  readonly key: string
  readonly label: string
  readonly kind: WaterfallStepKind
  /** Non-negative magnitude of the step, in cents. */
  readonly amountCents: number
  readonly startCents: number
  readonly endCents: number
  readonly increase: boolean
}

/** The figures the waterfall reads, straight from a member's estimate. */
export interface TaxWaterfallInput {
  readonly grossCents: number
  readonly deductionsCents: number
  readonly concessionalCents: number
  readonly breakdown: TaxBreakdown
  readonly afterTaxCents: number
}

/**
 * Turns a member's estimate into the steps of a waterfall from gross income down
 * to take-home. Gross opens the flow; deductions and the concessional super
 * diverted to the fund step it down to taxable income; each tax component (income
 * tax net of the Low Income Tax Offset, the Medicare levy and its surcharge, the
 * HELP/HECS repayment, and Division 293) steps it down further; and take-home
 * closes it.
 *
 * A deduction lowers taxable income — and so the tax bars that follow — but is not
 * paid out of cash, so it is returned as a `Deductions kept` step before take-home;
 * its down-and-up pair nets to nil cash, leaving only the smaller tax as its
 * benefit. Every step is drawn from the estimate's own fields, so the bars
 * reconcile to the real take-home; a zero-magnitude step is omitted rather than
 * drawn empty.
 */
export function taxWaterfallSteps(input: TaxWaterfallInput): WaterfallStep[] {
  const { grossCents, deductionsCents, concessionalCents, breakdown, afterTaxCents } = input
  const netIncomeTaxCents = Math.max(0, breakdown.incomeTaxCents - breakdown.litoOffsetCents)
  const steps: WaterfallStep[] = [
    {
      key: 'gross',
      label: 'Gross income',
      kind: 'income',
      amountCents: grossCents,
      startCents: 0,
      endCents: grossCents,
      increase: false,
    },
  ]
  let running = grossCents
  const reduce = (
    key: string,
    label: string,
    kind: WaterfallStepKind,
    amountCents: number,
  ): void => {
    if (amountCents <= 0) {
      return
    }
    const endCents = running
    running -= amountCents
    steps.push({ key, label, kind, amountCents, startCents: running, endCents, increase: false })
  }
  reduce('deductions', 'Deductions', 'deduction', deductionsCents)
  reduce('concessional-super', 'Concessional super', 'super', concessionalCents)
  reduce('income-tax', 'Income tax', 'tax', netIncomeTaxCents)
  reduce('medicare-levy', 'Medicare levy', 'tax', breakdown.medicareLevyCents)
  reduce(
    'medicare-levy-surcharge',
    'Medicare levy surcharge',
    'tax',
    breakdown.medicareLevySurchargeCents,
  )
  reduce('help-repayment', 'HELP/HECS repayment', 'tax', breakdown.helpRepaymentCents)
  reduce('division-293', 'Division 293 tax', 'tax', breakdown.division293Cents)
  // A deduction cuts taxable income, not cash, so return it before take-home: the
  // down-and-up pair nets to nil cash, leaving the smaller tax as its only effect.
  if (deductionsCents > 0) {
    const startCents = running
    running += deductionsCents
    steps.push({
      key: 'deductions-kept',
      label: 'Deductions kept',
      kind: 'deduction',
      amountCents: deductionsCents,
      startCents,
      endCents: running,
      increase: true,
    })
  }
  steps.push({
    key: 'take-home',
    label: 'Take-home pay',
    kind: 'result',
    amountCents: afterTaxCents,
    startCents: 0,
    endCents: afterTaxCents,
    increase: false,
  })
  return steps
}
