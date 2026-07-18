import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { HouseholdTaxEstimate, MemberTaxEstimate, TaxBreakdown } from '@budget/tax'
import { TaxEstimateView } from './TaxEstimateView'

const breakdown: TaxBreakdown = {
  taxableIncomeCents: 0,
  incomeTaxCents: 0,
  litoOffsetCents: 0,
  medicareLevyCents: 0,
  medicareLevySurchargeCents: 0,
  helpRepaymentCents: 0,
  totalLiabilityCents: 0,
  paygWithheldCents: 0,
  balanceCents: 0,
}

const will: MemberTaxEstimate = {
  memberId: 'm1',
  annualGrossCents: 10_000_000,
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

    const willRow = screen.getByRole('row', { name: /Will/ })
    expect(within(willRow).getByText('$100,000.00')).toBeInTheDocument()
    expect(within(willRow).getByText('$25,000.00')).toBeInTheDocument()
    expect(within(willRow).getByText('$75,000.00')).toBeInTheDocument()
    expect(within(willRow).getByText('$3,846.15')).toBeInTheDocument()
    expect(within(willRow).getByText('$961.54')).toBeInTheDocument()
    expect(within(willRow).getByText('$2,884.61')).toBeInTheDocument()

    const samRow = screen.getByRole('row', { name: /Sam/ })
    expect(within(samRow).getByText('$60,000.00')).toBeInTheDocument()
    expect(within(samRow).getByText('$50,000.00')).toBeInTheDocument()
  })

  it('renders the household totals', () => {
    render(<TaxEstimateView estimate={estimate} financialYear={2027} memberName={memberName} />)

    const householdRow = screen.getByRole('row', { name: /Household/ })
    expect(within(householdRow).getByText('$160,000.00')).toBeInTheDocument()
    expect(within(householdRow).getByText('$35,000.00')).toBeInTheDocument()
    expect(within(householdRow).getByText('$125,000.00')).toBeInTheDocument()
    expect(within(householdRow).getByText('$6,153.84')).toBeInTheDocument()
    expect(within(householdRow).getByText('$4,807.68')).toBeInTheDocument()
  })

  it('shows the financial year in the heading', () => {
    render(<TaxEstimateView estimate={estimate} financialYear={2027} memberName={memberName} />)
    expect(screen.getByRole('heading', { name: /FY2027/ })).toBeInTheDocument()
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

    expect(screen.getByText(/add income on the income tab/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
