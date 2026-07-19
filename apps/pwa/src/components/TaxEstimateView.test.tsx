import { describe, expect, it } from 'vitest'
import type { HouseholdTaxEstimate, MemberTaxEstimate, TaxBreakdown } from '@budget/tax'
import { render, screen, within } from '../test/render'
import { TaxEstimateView } from './TaxEstimateView'

const breakdown: TaxBreakdown = {
  taxableIncomeCents: 0,
  incomeTaxCents: 0,
  litoOffsetCents: 0,
  medicareLevyCents: 0,
  medicareLevySurchargeCents: 0,
  helpRepaymentCents: 0,
  division293Cents: 0,
  totalLiabilityCents: 0,
  paygWithheldCents: 0,
  balanceCents: 0,
}

const will: MemberTaxEstimate = {
  memberId: 'm1',
  annualGrossCents: 10_000_000,
  annualConcessionalContributionsCents: 0,
  annualTaxCents: 2_500_000,
  annualAfterTaxCents: 7_500_000,
  fortnightlyGrossCents: 384_615,
  fortnightlyTaxCents: 96_154,
  fortnightlyAfterTaxCents: 288_461,
  breakdown,
}

const sam: MemberTaxEstimate = {
  memberId: 'm2',
  annualGrossCents: 6_000_000,
  annualConcessionalContributionsCents: 0,
  annualTaxCents: 1_000_000,
  annualAfterTaxCents: 5_000_000,
  fortnightlyGrossCents: 230_769,
  fortnightlyTaxCents: 38_462,
  fortnightlyAfterTaxCents: 192_307,
  breakdown,
}

const estimate: HouseholdTaxEstimate = {
  members: [will, sam],
  annualGrossCents: 16_000_000,
  annualTaxCents: 3_500_000,
  annualAfterTaxCents: 12_500_000,
  fortnightlyGrossCents: 615_384,
  fortnightlyTaxCents: 134_616,
  fortnightlyAfterTaxCents: 480_768,
}

const memberName = (id: string) => ({ m1: 'Will', m2: 'Sam' })[id] ?? 'Unknown'

describe('TaxEstimateView', () => {
  it('renders per-member annual and fortnightly figures by name', () => {
    render(<TaxEstimateView estimate={estimate} financialYear={2027} memberName={memberName} />)

    const willCard = screen.getByRole('region', { name: 'Will' })
    expect(within(willCard).getByText('$100,000.00')).toBeInTheDocument()
    expect(within(willCard).getByText('$25,000.00')).toBeInTheDocument()
    expect(within(willCard).getByText('$75,000.00')).toBeInTheDocument()
    expect(within(willCard).getByText('$3,846.15')).toBeInTheDocument()
    expect(within(willCard).getByText('$961.54')).toBeInTheDocument()
    expect(within(willCard).getByText('$2,884.61')).toBeInTheDocument()

    const samCard = screen.getByRole('region', { name: 'Sam' })
    expect(within(samCard).getByText('$60,000.00')).toBeInTheDocument()
    expect(within(samCard).getByText('$50,000.00')).toBeInTheDocument()
  })

  it('lays out each card as an annual/fortnightly table with gross/tax/after-tax columns', () => {
    render(<TaxEstimateView estimate={estimate} financialYear={2027} memberName={memberName} />)

    const willCard = screen.getByRole('region', { name: 'Will' })
    expect(within(willCard).getByRole('columnheader', { name: 'Gross' })).toBeInTheDocument()
    expect(within(willCard).getByRole('columnheader', { name: 'Tax' })).toBeInTheDocument()
    expect(within(willCard).getByRole('columnheader', { name: 'After tax' })).toBeInTheDocument()
    expect(within(willCard).getByRole('rowheader', { name: 'Annual' })).toBeInTheDocument()
    expect(within(willCard).getByRole('rowheader', { name: 'Fortnightly' })).toBeInTheDocument()
  })

  it('renders the household totals', () => {
    render(<TaxEstimateView estimate={estimate} financialYear={2027} memberName={memberName} />)

    const householdCard = screen.getByRole('region', { name: 'Household' })
    expect(within(householdCard).getByText('$160,000.00')).toBeInTheDocument()
    expect(within(householdCard).getByText('$35,000.00')).toBeInTheDocument()
    expect(within(householdCard).getByText('$125,000.00')).toBeInTheDocument()
    expect(within(householdCard).getByText('$6,153.84')).toBeInTheDocument()
    expect(within(householdCard).getByText('$4,807.68')).toBeInTheDocument()
  })

  it('orders the household card before the member cards', () => {
    render(<TaxEstimateView estimate={estimate} financialYear={2027} memberName={memberName} />)

    const [first, ...rest] = screen.getAllByRole('region')
    expect(first).toHaveAccessibleName('Household')
    expect(rest.map((region) => region.getAttribute('aria-label'))).toEqual(['Will', 'Sam'])
  })

  it('shows the financial year in the heading', () => {
    render(<TaxEstimateView estimate={estimate} financialYear={2027} memberName={memberName} />)
    expect(screen.getByRole('heading', { name: /FY2027/ })).toBeInTheDocument()
  })

  it('shows concessional super and a Division 293 line for a member with contributions', () => {
    const willWithSuper: MemberTaxEstimate = {
      ...will,
      annualConcessionalContributionsCents: 26_000_00,
      breakdown: { ...breakdown, division293Cents: 1_500_00 },
    }
    const withSuper: HouseholdTaxEstimate = { ...estimate, members: [willWithSuper, sam] }
    render(<TaxEstimateView estimate={withSuper} financialYear={2027} memberName={memberName} />)

    const willCard = screen.getByRole('region', { name: 'Will' })
    // Annual $26,000 and its fortnightly split $1,000 both shown.
    expect(within(willCard).getByText(/Concessional super/)).toHaveTextContent('$26,000.00/yr')
    expect(within(willCard).getByText(/Concessional super/)).toHaveTextContent(
      '$1,000.00/fortnight',
    )
    expect(within(willCard).getByText(/Division 293 tax/)).toHaveTextContent('$1,500.00')

    // Sam has no contributions, so neither line appears.
    const samCard = screen.getByRole('region', { name: 'Sam' })
    expect(within(samCard).queryByText(/Concessional super/)).not.toBeInTheDocument()
    expect(within(samCard).queryByText(/Division 293 tax/)).not.toBeInTheDocument()
  })

  it('shows an empty state prompting to add income when gross is zero', () => {
    const empty: HouseholdTaxEstimate = {
      members: [],
      annualGrossCents: 0,
      annualTaxCents: 0,
      annualAfterTaxCents: 0,
      fortnightlyGrossCents: 0,
      fortnightlyTaxCents: 0,
      fortnightlyAfterTaxCents: 0,
    }
    render(<TaxEstimateView estimate={empty} financialYear={2027} memberName={memberName} />)

    expect(screen.getByText(/add a taxable inflow on the inflows tab/i)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
