import { describe, expect, it } from 'vitest'
import type { TaxBreakdown } from '@nest/tax'
import { taxWaterfallSteps, type WaterfallStep } from './taxWaterfall'

const zeroBreakdown: TaxBreakdown = {
  taxableIncomeCents: 0,
  incomeForSurchargeCents: 0,
  incomeTaxCents: 0,
  litoOffsetCents: 0,
  oneOffOffsetCents: 0,
  medicareLevyCents: 0,
  medicareLevySurchargeCents: 0,
  helpRepaymentCents: 0,
  division293Cents: 0,
  totalLiabilityCents: 0,
  paygWithheldCents: 0,
  balanceCents: 0,
  repaymentIncomeCents: 0,
}

/** The net cash a step moves: a reduction takes away, an add-back returns. */
function cashDelta(step: WaterfallStep): number {
  if (step.kind === 'income' || step.kind === 'result') {
    return 0
  }
  return step.increase ? step.amountCents : -step.amountCents
}

describe('taxWaterfallSteps', () => {
  it('opens with gross and closes with take-home, with no steps between when nothing is taken out', () => {
    const steps = taxWaterfallSteps({
      grossCents: 100_000_00,
      deductionsCents: 0,
      concessionalCents: 0,
      breakdown: zeroBreakdown,
      afterTaxCents: 100_000_00,
    })
    expect(steps.map((step) => step.key)).toEqual(['gross', 'take-home'])
    expect(steps[0]).toMatchObject({ kind: 'income', startCents: 0, endCents: 100_000_00 })
    expect(steps[1]).toMatchObject({ kind: 'result', startCents: 0, endCents: 100_000_00 })
  })

  it('steps each reduction down from gross so the bars reconcile to take-home', () => {
    const steps = taxWaterfallSteps({
      grossCents: 100_000_00,
      deductionsCents: 0,
      concessionalCents: 10_000_00,
      breakdown: {
        ...zeroBreakdown,
        incomeTaxCents: 20_000_00,
        litoOffsetCents: 500_00,
        medicareLevyCents: 1_800_00,
        helpRepaymentCents: 3_000_00,
      },
      // 100,000 − 10,000 − (20,000 − 500) − 1,800 − 3,000 = 65,700
      afterTaxCents: 65_700_00,
    })

    expect(steps.map((step) => step.label)).toEqual([
      'Gross income',
      'Concessional super',
      'Income tax',
      'Medicare levy',
      'HELP/HECS repayment',
      'Take-home pay',
    ])
    // Income tax is net of the Low Income Tax Offset.
    const incomeTax = steps.find((step) => step.key === 'income-tax')
    expect(incomeTax?.amountCents).toBe(19_500_00)
    // Each reduction floats between the running cash before and after it.
    const help = steps.find((step) => step.key === 'help-repayment')
    expect(help).toMatchObject({ startCents: 65_700_00, endCents: 68_700_00 })
    // The last reduction lands on the take-home level.
    expect(help?.startCents).toBe(steps.at(-1)?.endCents)
  })

  it('returns a deduction as its own step so cash nets to nil while tax still falls', () => {
    const steps = taxWaterfallSteps({
      grossCents: 100_000_00,
      deductionsCents: 5_000_00,
      concessionalCents: 0,
      breakdown: { ...zeroBreakdown, incomeTaxCents: 18_000_00, medicareLevyCents: 1_900_00 },
      // 100,000 − 18,000 − 1,900 = 80,100 (the deduction is not paid from cash)
      afterTaxCents: 80_100_00,
    })

    expect(steps.map((step) => step.key)).toEqual([
      'gross',
      'deductions',
      'income-tax',
      'medicare-levy',
      'deductions-kept',
      'take-home',
    ])
    // The deduction leaves taxable income (down) then returns as cash (up).
    const out = steps.find((step) => step.key === 'deductions')
    const kept = steps.find((step) => step.key === 'deductions-kept')
    expect(out).toMatchObject({ kind: 'deduction', increase: false, amountCents: 5_000_00 })
    expect(kept).toMatchObject({ kind: 'deduction', increase: true, amountCents: 5_000_00 })
    // The two deduction steps net to nil cash.
    expect(cashDelta(out!) + cashDelta(kept!)).toBe(0)
    // The tax steps sit on the deduction-reduced taxable income (gross − deduction).
    const incomeTax = steps.find((step) => step.key === 'income-tax')
    expect(incomeTax?.endCents).toBe(95_000_00)
    // Every step's cash movement sums back to take-home.
    const running = 100_000_00 + steps.reduce((total, step) => total + cashDelta(step), 0)
    expect(running).toBe(80_100_00)
    expect(steps.at(-1)).toMatchObject({ kind: 'result', endCents: 80_100_00 })
  })

  it('omits zero-magnitude reductions rather than drawing empty bars', () => {
    const steps = taxWaterfallSteps({
      grossCents: 80_000_00,
      deductionsCents: 0,
      concessionalCents: 0,
      breakdown: { ...zeroBreakdown, medicareLevyCents: 1_600_00, division293Cents: 0 },
      afterTaxCents: 78_400_00,
    })
    expect(steps.map((step) => step.key)).toEqual(['gross', 'medicare-levy', 'take-home'])
  })

  it('floors income tax at zero when the offset exceeds the gross income tax', () => {
    const steps = taxWaterfallSteps({
      grossCents: 20_000_00,
      deductionsCents: 0,
      concessionalCents: 0,
      breakdown: { ...zeroBreakdown, incomeTaxCents: 300_00, litoOffsetCents: 700_00 },
      afterTaxCents: 20_000_00,
    })
    expect(steps.some((step) => step.key === 'income-tax')).toBe(false)
  })
})
