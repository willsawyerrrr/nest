import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  FY2027_CONFIG,
  type HelpPayoffProjection,
  type HouseholdTaxEstimate,
  type MemberTaxEstimate,
  type TaxBreakdown,
  type TaxInput,
} from '@nest/tax'
import { render, screen, within } from '../test/render'
import { TaxEstimateView } from './TaxEstimateView'

const config = FY2027_CONFIG

const breakdown: TaxBreakdown = {
  taxableIncomeCents: 0,
  incomeForSurchargeCents: 0,
  incomeTaxCents: 0,
  litoOffsetCents: 0,
  medicareLevyCents: 0,
  medicareLevySurchargeCents: 0,
  helpRepaymentCents: 0,
  division293Cents: 0,
  totalLiabilityCents: 0,
  paygWithheldCents: 0,
  balanceCents: 0,
  repaymentIncomeCents: 0,
}

/** A `TaxInput` for a resident on `salaryCents` with no other attributes. */
function inputFor(salaryCents: number): TaxInput {
  return {
    assessableIncome: {
      salaryOrWagesCents: salaryCents,
      businessCents: 0,
      investmentCents: 0,
      otherCents: 0,
    },
    deductionsCents: 0,
    residency: 'resident',
    privateHospitalCover: false,
    helpDebtCents: 0,
    paygWithheldCents: 0,
    concessionalContributionsCents: 0,
  }
}

const will: MemberTaxEstimate = {
  memberId: 'm1',
  annualGrossCents: 10_000_000,
  annualConcessionalContributionsCents: 0,
  annualNetConcessionalSuperCents: 0,
  annualDeductionsCents: 0,
  annualTaxCents: 2_500_000,
  annualAfterTaxCents: 7_500_000,
  fortnightlyGrossCents: 384_615,
  fortnightlyTaxCents: 96_154,
  fortnightlyAfterTaxCents: 288_461,
  breakdown,
  input: inputFor(10_000_000),
}

const sam: MemberTaxEstimate = {
  memberId: 'm2',
  annualGrossCents: 6_000_000,
  annualConcessionalContributionsCents: 0,
  annualNetConcessionalSuperCents: 0,
  annualDeductionsCents: 0,
  annualTaxCents: 1_000_000,
  annualAfterTaxCents: 5_000_000,
  fortnightlyGrossCents: 230_769,
  fortnightlyTaxCents: 38_462,
  fortnightlyAfterTaxCents: 192_307,
  breakdown,
  input: inputFor(6_000_000),
}

const estimate: HouseholdTaxEstimate = {
  members: [will, sam],
  annualGrossCents: 16_000_000,
  annualConcessionalContributionsCents: 0,
  annualNetConcessionalSuperCents: 0,
  annualDeductionsCents: 0,
  annualTaxCents: 3_500_000,
  annualAfterTaxCents: 12_500_000,
  fortnightlyGrossCents: 615_384,
  fortnightlyTaxCents: 134_616,
  fortnightlyAfterTaxCents: 480_768,
}

const memberName = (id: string) => ({ m1: 'Will', m2: 'Sam' })[id] ?? 'Unknown'

/** The gross/tax/after-tax summary table within a named card. */
function summaryTable(name: string) {
  return within(screen.getByRole('region', { name })).getByRole('table', {
    name: 'Income and tax summary',
  })
}

/** The gross-to-taxable-income build-up table within a named card. */
function incomeTable(name: string) {
  return within(screen.getByRole('region', { name })).getByRole('table', { name: 'Taxable income' })
}

describe('TaxEstimateView', () => {
  it('renders per-member annual and fortnightly figures by name', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willSummary = summaryTable('Will')
    expect(within(willSummary).getByText('$100,000.00')).toBeInTheDocument()
    expect(within(willSummary).getByText('$25,000.00')).toBeInTheDocument()
    expect(within(willSummary).getByText('$75,000.00')).toBeInTheDocument()
    expect(within(willSummary).getByText('$3,846.15')).toBeInTheDocument()
    expect(within(willSummary).getByText('$961.54')).toBeInTheDocument()
    expect(within(willSummary).getByText('$2,884.61')).toBeInTheDocument()

    const samSummary = summaryTable('Sam')
    expect(within(samSummary).getByText('$60,000.00')).toBeInTheDocument()
    expect(within(samSummary).getByText('$50,000.00')).toBeInTheDocument()
  })

  it('lays out each card as an annual/fortnightly table with gross/tax/after-tax columns', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willCard = screen.getByRole('region', { name: 'Will' })
    expect(within(willCard).getByRole('columnheader', { name: 'Gross' })).toBeInTheDocument()
    expect(within(willCard).getByRole('columnheader', { name: 'Tax' })).toBeInTheDocument()
    expect(within(willCard).getByRole('columnheader', { name: 'After tax' })).toBeInTheDocument()
    expect(within(willCard).getByRole('rowheader', { name: 'Annual' })).toBeInTheDocument()
    expect(within(willCard).getByRole('rowheader', { name: 'Fortnightly' })).toBeInTheDocument()
  })

  it('renders the household totals', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const householdCard = screen.getByRole('region', { name: 'Household' })
    expect(within(householdCard).getByText('$160,000.00')).toBeInTheDocument()
    expect(within(householdCard).getByText('$35,000.00')).toBeInTheDocument()
    expect(within(householdCard).getByText('$125,000.00')).toBeInTheDocument()
    expect(within(householdCard).getByText('$6,153.84')).toBeInTheDocument()
    expect(within(householdCard).getByText('$4,807.68')).toBeInTheDocument()
  })

  it('shows no income build-up on the household card, which has no per-component breakdown', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const householdCard = screen.getByRole('region', { name: 'Household' })
    expect(within(householdCard).queryByRole('table', { name: 'Taxable income' })).toBeNull()
    expect(within(householdCard).queryByRole('table', { name: 'Tax breakdown' })).toBeNull()
  })

  it('orders the household card before the member cards', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const [first, ...rest] = screen.getAllByRole('region')
    expect(first).toHaveAccessibleName('Household')
    // The MLS what-if follows the household card, before the per-member cards.
    expect(rest.map((region) => region.getAttribute('aria-label'))).toEqual([
      'Private hospital cover',
      'Will',
      'Sam',
    ])
  })

  it('shows the financial year in the heading', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    expect(screen.getByRole('heading', { name: /FY2027/ })).toBeInTheDocument()
  })

  it('builds up taxable income from gross less concessional super', () => {
    const willWithSuper: MemberTaxEstimate = {
      ...will,
      annualConcessionalContributionsCents: 26_000_00,
      breakdown: { ...breakdown, taxableIncomeCents: 74_000_00 },
    }
    const withSuper: HouseholdTaxEstimate = { ...estimate, members: [willWithSuper, sam] }
    render(
      <TaxEstimateView
        estimate={withSuper}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willIncome = incomeTable('Will')
    expect(within(willIncome).getByRole('row', { name: /Gross income/ })).toHaveTextContent(
      '$100,000.00',
    )
    // The concessional super deduction reads as a subtraction, annual and fortnightly.
    const concessional = within(willIncome).getByRole('row', { name: /Concessional super/ })
    expect(concessional).toHaveTextContent('-$26,000.00')
    expect(concessional).toHaveTextContent('-$1,000.00')
    expect(within(willIncome).getByRole('row', { name: /Taxable income/ })).toHaveTextContent(
      '$74,000.00',
    )
  })

  it('shows gross and taxable income with no deduction row when there is no concessional super', () => {
    const noSuper: MemberTaxEstimate = {
      ...will,
      breakdown: { ...breakdown, taxableIncomeCents: 100_000_00 },
    }
    const withoutSuper: HouseholdTaxEstimate = { ...estimate, members: [noSuper, sam] }
    render(
      <TaxEstimateView
        estimate={withoutSuper}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willIncome = incomeTable('Will')
    expect(within(willIncome).getByRole('row', { name: /Gross income/ })).toHaveTextContent(
      '$100,000.00',
    )
    expect(within(willIncome).getByRole('row', { name: /Taxable income/ })).toHaveTextContent(
      '$100,000.00',
    )
    expect(within(willIncome).queryByRole('row', { name: /Concessional super/ })).toBeNull()
  })

  it('shows a Deductions row for a member with deductions, absent otherwise', () => {
    const willWithDeductions: MemberTaxEstimate = {
      ...will,
      annualDeductionsCents: 5_000_00,
      breakdown: { ...breakdown, taxableIncomeCents: 95_000_00 },
    }
    const withDeductions: HouseholdTaxEstimate = { ...estimate, members: [willWithDeductions, sam] }
    render(
      <TaxEstimateView
        estimate={withDeductions}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willIncome = incomeTable('Will')
    const deductions = within(willIncome).getByRole('row', { name: /Deductions/ })
    // The deduction reads as a subtraction from gross toward taxable income.
    expect(deductions).toHaveTextContent('-$5,000.00')

    // Sam has no deductions, so the Deductions row is absent.
    const samIncome = incomeTable('Sam')
    expect(within(samIncome).queryByRole('row', { name: /Deductions/ })).toBeNull()
  })

  it('shows a Division 293 line for a member with contributions, absent otherwise', () => {
    const willWithSuper: MemberTaxEstimate = {
      ...will,
      annualConcessionalContributionsCents: 26_000_00,
      breakdown: { ...breakdown, division293Cents: 1_500_00 },
    }
    const withSuper: HouseholdTaxEstimate = { ...estimate, members: [willWithSuper, sam] }
    render(
      <TaxEstimateView
        estimate={withSuper}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willCard = screen.getByRole('region', { name: 'Will' })
    expect(within(willCard).getByRole('row', { name: /Division 293 tax/ })).toHaveTextContent(
      '$1,500.00',
    )

    // Sam has no contributions, so the concessional line and Division 293 row are absent.
    const samCard = screen.getByRole('region', { name: 'Sam' })
    expect(within(samCard).queryByRole('row', { name: /Concessional super/ })).toBeNull()
    expect(within(samCard).queryByRole('row', { name: /Division 293 tax/ })).toBeNull()
  })

  it('builds up total tax from its components for a member', () => {
    const willFull: MemberTaxEstimate = {
      ...will,
      breakdown: {
        taxableIncomeCents: 100_000_00,
        incomeForSurchargeCents: 100_000_00,
        incomeTaxCents: 24_000_00,
        litoOffsetCents: 700_00,
        medicareLevyCents: 2_000_00,
        medicareLevySurchargeCents: 1_000_00,
        helpRepaymentCents: 3_000_00,
        division293Cents: 1_500_00,
        totalLiabilityCents: 30_800_00,
        paygWithheldCents: 0,
        balanceCents: 30_800_00,
        repaymentIncomeCents: 100_000_00,
      },
    }
    const withFull: HouseholdTaxEstimate = { ...estimate, members: [willFull, sam] }
    render(
      <TaxEstimateView
        estimate={withFull}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willTax = within(screen.getByRole('region', { name: 'Will' })).getByRole('table', {
      name: 'Tax breakdown',
    })
    expect(within(willTax).getByRole('row', { name: /Income tax/ })).toHaveTextContent('$24,000.00')
    // The offset reads as a subtraction.
    expect(within(willTax).getByRole('row', { name: /Low Income Tax Offset/ })).toHaveTextContent(
      '-$700.00',
    )
    expect(
      within(willTax).getByRole('row', { name: /Medicare levy surcharge/ }),
    ).toBeInTheDocument()
    expect(within(willTax).getByRole('row', { name: /HELP\/HECS repayment/ })).toBeInTheDocument()
    expect(within(willTax).getByRole('row', { name: /Total tax/ })).toHaveTextContent('$30,800.00')
  })

  it('always shows income tax, Medicare levy, and total tax even at zero', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    // Sam's breakdown is all zero, yet the core rows are still present.
    const samTax = within(screen.getByRole('region', { name: 'Sam' })).getByRole('table', {
      name: 'Tax breakdown',
    })
    expect(within(samTax).getByRole('row', { name: /Income tax/ })).toBeInTheDocument()
    expect(within(samTax).getByRole('row', { name: /Medicare levy/ })).toBeInTheDocument()
    expect(within(samTax).getByRole('row', { name: /Total tax/ })).toBeInTheDocument()
    // Non-applicable components are named rather than shown as noisy $0 rows.
    expect(within(samTax).queryByRole('row', { name: /Medicare levy surcharge/ })).toBeNull()
    const samCard = screen.getByRole('region', { name: 'Sam' })
    expect(within(samCard).getByText(/Not applicable this year/)).toHaveTextContent(
      'Medicare levy surcharge',
    )
  })

  it('shows a projected payoff year for a member with a clearing HELP debt', () => {
    const paidOff: HelpPayoffProjection = {
      paidOffFinancialYear: 2032,
      yearsToPayOff: 6,
      schedule: [],
    }
    const helpPayoff = new Map([['m1', paidOff]])
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
        helpPayoff={helpPayoff}
      />,
    )

    const willCard = screen.getByRole('region', { name: 'Will' })
    expect(
      within(willCard).getByText(/projected paid off in FY2032 \(6 years\)/),
    ).toBeInTheDocument()
    // Sam has no HELP debt, so no payoff line appears on their card.
    const samCard = screen.getByRole('region', { name: 'Sam' })
    expect(within(samCard).queryByText(/HELP debt/)).toBeNull()
  })

  it('notes when a HELP debt does not clear within the projection horizon', () => {
    const neverClears: HelpPayoffProjection = {
      paidOffFinancialYear: null,
      yearsToPayOff: null,
      schedule: [],
    }
    const helpPayoff = new Map([['m1', neverClears]])
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
        helpPayoff={helpPayoff}
      />,
    )

    const willCard = screen.getByRole('region', { name: 'Will' })
    expect(
      within(willCard).getByText(/not cleared within 40 years at current income/),
    ).toBeInTheDocument()
  })

  it('notes that capital gains tax is excluded', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    expect(screen.getByText(/excludes capital gains tax/i)).toBeInTheDocument()
  })

  // Combined surcharge income $270,000 sits in the FY2027 family 1.25% tier.
  const surchargeEstimate: HouseholdTaxEstimate = {
    ...estimate,
    members: [
      { ...will, breakdown: { ...breakdown, incomeForSurchargeCents: 150_000_00 } },
      { ...sam, breakdown: { ...breakdown, incomeForSurchargeCents: 120_000_00 } },
    ],
  }
  const whatIf = () => screen.getByRole('region', { name: 'Private hospital cover' })

  it('renders the MLS what-if with its dependents and premium inputs', () => {
    render(
      <TaxEstimateView
        estimate={surchargeEstimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    const panel = whatIf()
    expect(within(panel).getByLabelText(/dependent children/i)).toBeInTheDocument()
    expect(within(panel).getByLabelText(/hospital cover premium/i)).toBeInTheDocument()
    // Without cover, combined income lands in the 1.25% tier = $3,375.00/yr.
    expect(within(panel).getByText(/\$270,000\.00/)).toBeInTheDocument()
    expect(within(panel).getByText(/1\.25% MLS tier/)).toBeInTheDocument()
    expect(within(panel).getByText(/\$3,375\.00\/yr/)).toBeInTheDocument()
  })

  it('shows cover saving money when the premium is below the surcharge', async () => {
    const user = userEvent.setup()
    render(
      <TaxEstimateView
        estimate={surchargeEstimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    const premium = within(whatIf()).getByLabelText(/hospital cover premium/i)
    await user.clear(premium)
    await user.type(premium, '2000')
    // $3,375 surcharge − $2,000 premium = $1,375 saved by holding cover.
    expect(within(whatIf()).getByText(/saves \$1,375\.00\/yr/)).toBeInTheDocument()
  })

  it('shows cover costing more when the premium exceeds the surcharge', async () => {
    const user = userEvent.setup()
    render(
      <TaxEstimateView
        estimate={surchargeEstimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    const premium = within(whatIf()).getByLabelText(/hospital cover premium/i)
    await user.clear(premium)
    await user.type(premium, '5000')
    // $5,000 premium − $3,375 surcharge = $1,625 more than the surcharge avoided.
    expect(within(whatIf()).getByText(/costs \$1,625\.00\/yr more/)).toBeInTheDocument()
  })

  it('recomputes below the family threshold as dependent children rise', async () => {
    const user = userEvent.setup()
    // Combined surcharge income $211,000 — just over the $210,000 family floor.
    const justOver: HouseholdTaxEstimate = {
      ...estimate,
      members: [
        { ...will, breakdown: { ...breakdown, incomeForSurchargeCents: 110_000_00 } },
        { ...sam, breakdown: { ...breakdown, incomeForSurchargeCents: 101_000_00 } },
      ],
    }
    render(
      <TaxEstimateView
        estimate={justOver}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    expect(within(whatIf()).getByText(/1% MLS tier/)).toBeInTheDocument()
    // Two children raise the family floor by $1,500 to $211,500, above $211,000.
    const children = within(whatIf()).getByLabelText(/dependent children/i)
    await user.clear(children)
    await user.type(children, '2')
    expect(within(whatIf()).getByText(/Below the family MLS threshold/)).toBeInTheDocument()
  })

  it('shows an empty state prompting to add income when gross is zero', () => {
    const empty: HouseholdTaxEstimate = {
      members: [],
      annualGrossCents: 0,
      annualConcessionalContributionsCents: 0,
      annualNetConcessionalSuperCents: 0,
      annualDeductionsCents: 0,
      annualTaxCents: 0,
      annualAfterTaxCents: 0,
      fortnightlyGrossCents: 0,
      fortnightlyTaxCents: 0,
      fortnightlyAfterTaxCents: 0,
    }
    render(
      <TaxEstimateView
        estimate={empty}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    expect(screen.getByText(/add a taxable inflow on the inflows tab/i)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('shows the salary-sacrifice readout only after an amount is entered, and updates it live', async () => {
    const user = userEvent.setup()
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willCard = screen.getByRole('region', { name: 'Will' })
    // The what-if is per member, on each member card.
    const input = within(willCard).getByLabelText(/extra salary sacrifice per year/i)
    // No readout until an amount is entered.
    expect(within(willCard).queryByText(/tax saved/i)).toBeNull()

    await user.type(input, '10000')

    expect(within(willCard).getByText(/tax saved/i)).toBeInTheDocument()
    // $10,000 sacrifice lands 85% ($8,500) in super after the 15% contributions tax.
    expect(within(willCard).getByText(/into super:/i)).toHaveTextContent('$8,500.00')
    expect(within(willCard).getByText(/take-home:/i)).toBeInTheDocument()

    // Changing the amount updates the net-to-super readout live (85% of $20,000).
    await user.clear(input)
    await user.type(input, '20000')
    expect(within(willCard).getByText(/into super:/i)).toHaveTextContent('$17,000.00')
  })

  it('warns when the extra sacrifice pushes a member past their concessional cap', async () => {
    const user = userEvent.setup()
    const caps = new Map([['m1', 30_000_00]])
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
        concessionalCapCentsByMember={caps}
      />,
    )

    const willCard = screen.getByRole('region', { name: 'Will' })
    const input = within(willCard).getByLabelText(/extra salary sacrifice per year/i)

    await user.type(input, '20000')
    expect(within(willCard).queryByText(/past the cap/i)).toBeNull()

    await user.clear(input)
    await user.type(input, '40000') // over the $30,000 cap
    expect(within(willCard).getByText(/past the cap/i)).toBeInTheDocument()
  })
})
