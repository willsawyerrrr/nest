import type { TaxBreakdown } from '@nest/tax'

/**
 * A step's role in the build-up: `income` is the opening gross bar, `reduction`
 * a floating bar for an amount taken out, and `result` the closing take-home bar.
 */
export type WaterfallStepKind = 'income' | 'reduction' | 'result'

/**
 * One step of the gross-to-take-home cash waterfall. `startCents`/`endCents` are
 * the lower and upper bounds of the step's bar on the shared cash axis: the
 * income and result bars run from zero to their level, and a reduction floats
 * between the running cash after it (`startCents`) and before it (`endCents`).
 */
export interface WaterfallStep {
  readonly key: string
  readonly label: string
  readonly kind: WaterfallStepKind
  /** Non-negative magnitude of the step, in cents. */
  readonly amountCents: number
  readonly startCents: number
  readonly endCents: number
}

/** The figures the waterfall reads, straight from a member's estimate. */
export interface TaxWaterfallInput {
  readonly grossCents: number
  readonly concessionalCents: number
  readonly breakdown: TaxBreakdown
  readonly afterTaxCents: number
}

/**
 * Turns a member's estimate into the steps of a cash waterfall from gross income
 * down to take-home: gross, less the concessional super diverted to the fund,
 * less each tax component (income tax net of the Low Income Tax Offset, the
 * Medicare levy and its surcharge, the HELP/HECS repayment, and Division 293),
 * ending at take-home. Deductions are not a step — they cut taxable income, not
 * cash, so they show only as a smaller income-tax bar. Every reduction is drawn
 * from the estimate's own fields, so the steps sum back to take-home; a
 * zero-magnitude reduction is omitted rather than drawn as an empty bar.
 */
export function taxWaterfallSteps(input: TaxWaterfallInput): WaterfallStep[] {
  const { grossCents, concessionalCents, breakdown, afterTaxCents } = input
  const netIncomeTaxCents = Math.max(0, breakdown.incomeTaxCents - breakdown.litoOffsetCents)
  const steps: WaterfallStep[] = [
    {
      key: 'gross',
      label: 'Gross income',
      kind: 'income',
      amountCents: grossCents,
      startCents: 0,
      endCents: grossCents,
    },
  ]
  let running = grossCents
  const reduce = (key: string, label: string, amountCents: number): void => {
    if (amountCents <= 0) {
      return
    }
    const endCents = running
    running -= amountCents
    steps.push({ key, label, kind: 'reduction', amountCents, startCents: running, endCents })
  }
  reduce('concessional-super', 'Concessional super', concessionalCents)
  reduce('income-tax', 'Income tax', netIncomeTaxCents)
  reduce('medicare-levy', 'Medicare levy', breakdown.medicareLevyCents)
  reduce('medicare-levy-surcharge', 'Medicare levy surcharge', breakdown.medicareLevySurchargeCents)
  reduce('help-repayment', 'HELP/HECS repayment', breakdown.helpRepaymentCents)
  reduce('division-293', 'Division 293 tax', breakdown.division293Cents)
  steps.push({
    key: 'take-home',
    label: 'Take-home pay',
    kind: 'result',
    amountCents: afterTaxCents,
    startCents: 0,
    endCents: afterTaxCents,
  })
  return steps
}
