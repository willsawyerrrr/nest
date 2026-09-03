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
import { planningStorageKey } from '../lib/planningMode'
import { render, screen, within } from '../test/render'
import { PlanningModeProvider } from './PlanningModeProvider'
import { TaxEstimateView } from './TaxEstimateView'

const config = FY2027_CONFIG

const breakdown: TaxBreakdown = {
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

/** A `TaxInput` for a resident on `salaryCents` with no other attributes. */
function inputFor(salaryCents: number): TaxInput {
  return {
    assessableIncome: {
      salaryOrWagesCents: salaryCents,
      businessCents: 0,
      investmentCents: 0,
      otherCents: 0,
      employmentTerminationCents: 0,
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
  annualOneOffGrossCents: 0,
  annualOneOffAfterTaxCents: 0,
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
  annualOneOffGrossCents: 0,
  annualOneOffAfterTaxCents: 0,
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
  annualOneOffGrossCents: 0,
  annualOneOffAfterTaxCents: 0,
  fortnightlyGrossCents: 615_384,
  fortnightlyTaxCents: 134_616,
  fortnightlyAfterTaxCents: 480_768,
}

const memberName = (id: string) => ({ m1: 'Will', m2: 'Sam' })[id] ?? 'Unknown'

/** A named member/household card region. */
function card(name: string) {
  return screen.getByRole('region', { name })
}

/** Expands the collapsed "Show breakdown" accordion within a named card. */
async function showBreakdown(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(card(name)).getByRole('button', { name: /show breakdown/i }))
}

/** Expands the collapsed "Salary sacrifice what-if" toggle within a named card. */
async function showSalarySacrifice(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(card(name)).getByRole('button', { name: /salary sacrifice what-if/i }))
}

/** The MLS what-if landmark region. */
const mlsWhatIf = () => screen.getByRole('region', { name: 'Private hospital cover' })

/** Expands the collapsed "Private hospital cover what-if" toggle. */
async function showMls(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(mlsWhatIf()).getByRole('button', { name: /private hospital cover what-if/i }),
  )
}

/** The gross-to-taxable-income build-up table within a named card (expanded first). */
function incomeTable(name: string) {
  return within(card(name)).getByRole('table', { name: 'Taxable income' })
}

/** The income build-up waterfall within a named card (expanded first). */
function waterfall(name: string) {
  return within(card(name)).getByRole('figure', { name: 'Income build-up' })
}

/** A member estimate whose breakdown carries actual withholding against a liability. */
function withWithholding(
  member: MemberTaxEstimate,
  paygWithheldCents: number,
  totalLiabilityCents: number,
): MemberTaxEstimate {
  return {
    ...member,
    breakdown: {
      ...member.breakdown,
      paygWithheldCents,
      totalLiabilityCents,
      balanceCents: totalLiabilityCents - paygWithheldCents,
    },
  }
}

describe('TaxEstimateView', () => {
  it('leads each member card with their take-home headline in both cadences', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willCard = card('Will')
    // Take-home leads the card, fortnightly and annual (both unique to the hero).
    expect(within(willCard).getByText('Take-home')).toBeInTheDocument()
    expect(within(willCard).getByText('$2,884.61')).toBeInTheDocument()
    expect(within(willCard).getByText('$75,000.00')).toBeInTheDocument()
    // Gross is a supporting figure alongside the headline.
    expect(within(willCard).getByText('Gross')).toBeInTheDocument()

    const samCard = card('Sam')
    expect(within(samCard).getByText('$1,923.07')).toBeInTheDocument()
    expect(within(samCard).getByText('$50,000.00')).toBeInTheDocument()
  })

  it('shows real → proposed on take-home, tax, and the balance while planning mode is active', () => {
    localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true, overrides: {} }))
    const realWill = withWithholding(will, 3_000_000, 2_200_000)
    const proposedWill: MemberTaxEstimate = {
      ...realWill,
      annualAfterTaxCents: 6_000_000,
      annualTaxCents: 4_000_000,
      breakdown: { ...realWill.breakdown, balanceCents: -500_000 },
    }
    const real: HouseholdTaxEstimate = { ...estimate, members: [realWill, sam] }
    const proposed: HouseholdTaxEstimate = {
      ...estimate,
      annualAfterTaxCents: 11_000_000,
      members: [proposedWill, sam],
    }
    render(
      <PlanningModeProvider householdId="h1">
        <TaxEstimateView
          estimate={proposed}
          baseline={real}
          financialYear={2027}
          memberName={memberName}
          config={config}
        />
      </PlanningModeProvider>,
    )
    const willCard = card('Will')
    // Take-home annual moved $75,000 → $60,000.
    expect(within(willCard).getByText('$75,000.00')).toBeInTheDocument()
    expect(within(willCard).getByText('$60,000.00')).toBeInTheDocument()
    // The tracked bill/refund figure moved too.
    expect(within(willCard).getByText(/refund/)).toBeInTheDocument()
    // The household card compares its own take-home.
    expect(within(card('Household')).getByText('$125,000.00')).toBeInTheDocument()
    expect(within(card('Household')).getByText('$110,000.00')).toBeInTheDocument()
  })

  it('shows a nil take-home-versus-tax split for a member with no gross income', () => {
    const zero: MemberTaxEstimate = {
      ...will,
      annualGrossCents: 0,
      annualTaxCents: 0,
      annualAfterTaxCents: 0,
      annualOneOffGrossCents: 0,
      annualOneOffAfterTaxCents: 0,
      fortnightlyGrossCents: 0,
      fortnightlyTaxCents: 0,
      fortnightlyAfterTaxCents: 0,
    }
    const withZero: HouseholdTaxEstimate = { ...estimate, members: [zero, sam] }
    render(
      <TaxEstimateView
        estimate={withZero}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willCard = card('Will')
    expect(within(willCard).getByText(/Take-home 0%/)).toBeInTheDocument()
    expect(within(willCard).getByText(/Tax 0%/)).toBeInTheDocument()
  })

  it('shows a take-home-versus-tax bar with the split as percentages', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willCard = card('Will')
    // Will keeps 75% of gross as take-home, 25% goes to tax.
    expect(within(willCard).getByText(/Take-home 75%/)).toBeInTheDocument()
    expect(within(willCard).getByText(/Tax 25%/)).toBeInTheDocument()
    // The detailed build-up sits behind a collapsed disclosure.
    expect(within(willCard).getByRole('button', { name: /show breakdown/i })).toBeInTheDocument()
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

  it('builds up taxable income from gross less concessional super', async () => {
    const user = userEvent.setup()
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

    await showBreakdown(user, 'Will')
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

  it('shows gross and taxable income with no deduction row when there is no concessional super', async () => {
    const user = userEvent.setup()
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

    await showBreakdown(user, 'Will')
    const willIncome = incomeTable('Will')
    expect(within(willIncome).getByRole('row', { name: /Gross income/ })).toHaveTextContent(
      '$100,000.00',
    )
    expect(within(willIncome).getByRole('row', { name: /Taxable income/ })).toHaveTextContent(
      '$100,000.00',
    )
    expect(within(willIncome).queryByRole('row', { name: /Concessional super/ })).toBeNull()
  })

  it('shows a Deductions row for a member with deductions, absent otherwise', async () => {
    const user = userEvent.setup()
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

    await showBreakdown(user, 'Will')
    const willIncome = incomeTable('Will')
    const deductions = within(willIncome).getByRole('row', { name: /Deductions/ })
    // The deduction reads as a subtraction from gross toward taxable income.
    expect(deductions).toHaveTextContent('-$5,000.00')

    // Sam has no deductions, so the Deductions row is absent.
    await showBreakdown(user, 'Sam')
    const samIncome = incomeTable('Sam')
    expect(within(samIncome).queryByRole('row', { name: /Deductions/ })).toBeNull()
  })

  it('shows a Division 293 line for a member with contributions, absent otherwise', async () => {
    const user = userEvent.setup()
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

    await showBreakdown(user, 'Will')
    const willCard = card('Will')
    expect(within(willCard).getByRole('row', { name: /Division 293 tax/ })).toHaveTextContent(
      '$1,500.00',
    )

    // Sam has no contributions, so the concessional line and Division 293 row are absent.
    await showBreakdown(user, 'Sam')
    const samCard = card('Sam')
    expect(within(samCard).queryByRole('row', { name: /Concessional super/ })).toBeNull()
    expect(within(samCard).queryByRole('row', { name: /Division 293 tax/ })).toBeNull()
  })

  it('builds up total tax from its components for a member', async () => {
    const user = userEvent.setup()
    const willFull: MemberTaxEstimate = {
      ...will,
      breakdown: {
        taxableIncomeCents: 100_000_00,
        incomeForSurchargeCents: 100_000_00,
        incomeTaxCents: 24_000_00,
        litoOffsetCents: 700_00,
        oneOffOffsetCents: 0,
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

    await showBreakdown(user, 'Will')
    const willTax = within(card('Will')).getByRole('table', {
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

  it('visualises the income build-up as a waterfall alongside the tables', async () => {
    const user = userEvent.setup()
    const willFull: MemberTaxEstimate = {
      ...will,
      annualConcessionalContributionsCents: 10_000_00,
      annualDeductionsCents: 5_000_00,
      breakdown: {
        ...breakdown,
        incomeTaxCents: 20_000_00,
        medicareLevyCents: 1_800_00,
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

    await showBreakdown(user, 'Will')
    const chart = waterfall('Will')
    // The gross endpoint, each applicable step, and take-home each read as a bar.
    expect(within(chart).getByText('Gross income')).toBeInTheDocument()
    expect(within(chart).getByText('Deductions')).toBeInTheDocument()
    expect(within(chart).getByText('Concessional super')).toBeInTheDocument()
    expect(within(chart).getByText('Income tax')).toBeInTheDocument()
    expect(within(chart).getByText('Medicare levy')).toBeInTheDocument()
    expect(within(chart).getByText('Take-home pay')).toBeInTheDocument()
    // A reduction annotates the amount taken out; a nil component draws no step.
    expect(within(chart).getByText('-$1,800.00')).toBeInTheDocument()
    expect(within(chart).queryByText(/Division 293/)).toBeNull()
    // A deduction leaves taxable income then returns as cash, so it nets to nil.
    expect(within(chart).getByText('-$5,000.00')).toBeInTheDocument()
    expect(within(chart).getByText('Deductions kept')).toBeInTheDocument()
    expect(within(chart).getByText('$5,000.00')).toBeInTheDocument()
    expect(
      within(chart).getByText(/lower taxable income and tax, not the cash/i),
    ).toBeInTheDocument()
    // The household card carries the headline figures but no per-component build-up.
    expect(
      within(screen.getByRole('region', { name: 'Household' })).queryByRole('figure'),
    ).toBeNull()
  })

  it('omits the waterfall for a member with no gross income', async () => {
    const user = userEvent.setup()
    const noIncome: MemberTaxEstimate = {
      ...will,
      annualGrossCents: 0,
      annualTaxCents: 0,
      annualAfterTaxCents: 0,
    }
    const withNoIncome: HouseholdTaxEstimate = { ...estimate, members: [noIncome, sam] }
    render(
      <TaxEstimateView
        estimate={withNoIncome}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    await showBreakdown(user, 'Will')
    // The build-up tables still render, but there is no gross income to plot.
    expect(within(card('Will')).getByRole('table', { name: 'Taxable income' })).toBeInTheDocument()
    expect(within(card('Will')).queryByRole('figure')).toBeNull()
  })

  it('always shows income tax, Medicare levy, and total tax even at zero', async () => {
    const user = userEvent.setup()
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    // Sam's breakdown is all zero, yet the core rows are still present.
    await showBreakdown(user, 'Sam')
    const samTax = within(card('Sam')).getByRole('table', {
      name: 'Tax breakdown',
    })
    expect(within(samTax).getByRole('row', { name: /Income tax/ })).toBeInTheDocument()
    expect(within(samTax).getByRole('row', { name: /Medicare levy/ })).toBeInTheDocument()
    expect(within(samTax).getByRole('row', { name: /Total tax/ })).toBeInTheDocument()
    // Non-applicable components are named rather than shown as noisy $0 rows.
    expect(within(samTax).queryByRole('row', { name: /Medicare levy surcharge/ })).toBeNull()
    const samCard = card('Sam')
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

  it('tracks toward a refund when payslips withheld more than the estimated tax', () => {
    render(
      <TaxEstimateView
        estimate={{ ...estimate, members: [withWithholding(will, 30_000_00, 25_000_00), sam] }}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const willCard = card('Will')
    expect(willCard).toHaveTextContent('Withheld so far $30,000.00 of $25,000.00 estimated tax.')
    expect(willCard).toHaveTextContent('Tracking toward a $5,000.00 refund.')
    // Sam has entered no payslip, so their card carries no position at all.
    expect(within(card('Sam')).queryByText(/withheld so far/i)).toBeNull()
  })

  it('tracks toward a bill when payslips withheld less than the estimated tax', () => {
    render(
      <TaxEstimateView
        estimate={{ ...estimate, members: [withWithholding(will, 20_000_00, 25_000_00), sam] }}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    expect(card('Will')).toHaveTextContent('Tracking toward a $5,000.00 bill.')
  })

  it('reports neither a refund nor a bill when withholding matches the estimate', () => {
    render(
      <TaxEstimateView
        estimate={{ ...estimate, members: [withWithholding(will, 25_000_00, 25_000_00), sam] }}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    expect(card('Will')).toHaveTextContent('Tracking toward no refund or bill.')
  })

  it('shows no withholding position at all until a payslip records some', () => {
    render(
      <TaxEstimateView
        estimate={estimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    expect(screen.queryByText(/withheld so far/i)).toBeNull()
    expect(screen.queryByText(/tracking toward/i)).toBeNull()
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
  it('keeps the MLS what-if collapsed until its toggle is opened', async () => {
    const user = userEvent.setup()
    render(
      <TaxEstimateView
        estimate={surchargeEstimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    // The region is present but its inputs stay hidden until opened.
    expect(within(mlsWhatIf()).getByLabelText(/dependent children/i)).not.toBeVisible()
    await showMls(user)
    expect(within(mlsWhatIf()).getByLabelText(/dependent children/i)).toBeVisible()
  })

  it('renders the MLS what-if with its dependents and premium inputs', async () => {
    const user = userEvent.setup()
    render(
      <TaxEstimateView
        estimate={surchargeEstimate}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )
    await showMls(user)
    const panel = mlsWhatIf()
    expect(within(panel).getByLabelText(/dependent children/i)).toBeInTheDocument()
    expect(within(panel).getByLabelText(/hospital cover premium/i)).toBeInTheDocument()
    // Without cover, combined income lands in the 1.25% tier = $3,375.00/yr.
    expect(within(panel).getByText(/\$270,000\.00/)).toBeInTheDocument()
    expect(within(panel).getByText(/1\.25% MLS tier/)).toBeInTheDocument()
    expect(panel).toHaveTextContent('$3,375.00/yr surcharge')
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
    await showMls(user)
    const premium = within(mlsWhatIf()).getByLabelText(/hospital cover premium/i)
    await user.clear(premium)
    await user.type(premium, '2000')
    // $3,375 surcharge − $2,000 premium = $1,375 saved by holding cover.
    expect(mlsWhatIf()).toHaveTextContent('saves $1,375.00/yr over paying the surcharge.')
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
    await showMls(user)
    const premium = within(mlsWhatIf()).getByLabelText(/hospital cover premium/i)
    await user.clear(premium)
    await user.type(premium, '5000')
    // $5,000 premium − $3,375 surcharge = $1,625 more than the surcharge avoided.
    expect(mlsWhatIf()).toHaveTextContent('costs $1,625.00/yr more than the surcharge.')
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
    await showMls(user)
    expect(within(mlsWhatIf()).getByText(/1% MLS tier/)).toBeInTheDocument()
    // Two children raise the family floor by $1,500 to $211,500, above $211,000.
    const children = within(mlsWhatIf()).getByLabelText(/dependent children/i)
    await user.clear(children)
    await user.type(children, '2')
    expect(within(mlsWhatIf()).getByText(/Below the family MLS threshold/)).toBeInTheDocument()
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
      annualOneOffGrossCents: 0,
      annualOneOffAfterTaxCents: 0,
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
    // The what-if is per member, collapsed (hidden) until its toggle is opened.
    expect(within(willCard).getByLabelText(/extra salary sacrifice per year/i)).not.toBeVisible()
    await showSalarySacrifice(user, 'Will')
    const input = within(willCard).getByLabelText(/extra salary sacrifice per year/i)
    expect(input).toBeVisible()
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
    await showSalarySacrifice(user, 'Will')
    const input = within(willCard).getByLabelText(/extra salary sacrifice per year/i)

    await user.type(input, '20000')
    expect(within(willCard).queryByText(/past the cap/i)).toBeNull()

    await user.clear(input)
    await user.type(input, '40000') // over the $30,000 cap
    expect(within(willCard).getByText(/past the cap/i)).toBeInTheDocument()
  })

  it('names one-off money in the annual figures and says the fortnightly ones exclude it', () => {
    const willWithOneOff: MemberTaxEstimate = {
      ...will,
      annualOneOffGrossCents: 40_000_00,
      annualOneOffAfterTaxCents: 22_000_00,
    }
    render(
      <TaxEstimateView
        estimate={{ ...estimate, members: [willWithOneOff, sam] }}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    const note = within(card('Will')).getByText(/of one-off money in the annual figures/)
    expect(note).toHaveTextContent('$40,000.00')
    // A member with none says nothing about it.
    expect(within(card('Sam')).queryByText(/one-off money/)).not.toBeInTheDocument()
  })

  it('subtracts a redundancy’s tax-free amount and the concession offset in the build-up', async () => {
    const user = userEvent.setup()
    const willWithRedundancy: MemberTaxEstimate = {
      ...will,
      annualOneOffGrossCents: 100_000_00,
      annualOneOffAfterTaxCents: 60_000_00,
      breakdown: { ...breakdown, taxableIncomeCents: 80_000_00, oneOffOffsetCents: 5_000_00 },
      input: {
        ...inputFor(10_000_000),
        assessableIncome: {
          ...inputFor(10_000_000).assessableIncome,
          employmentTerminationCents: 20_000_00,
        },
      },
    }
    render(
      <TaxEstimateView
        estimate={{ ...estimate, members: [willWithRedundancy, sam] }}
        financialYear={2027}
        memberName={memberName}
        config={config}
      />,
    )

    await showBreakdown(user, 'Will')
    expect(
      within(incomeTable('Will')).getByRole('row', { name: /Tax-free one-off payments/ }),
    ).toHaveTextContent('-$80,000.00')
    expect(within(card('Will')).getByText(/Gross income includes/)).toHaveTextContent('$100,000.00')
    expect(
      within(card('Will')).getByRole('row', { name: /Termination payment offset/ }),
    ).toHaveTextContent('-$5,000.00')
  })
})
