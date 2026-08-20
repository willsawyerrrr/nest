import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { HouseholdTaxEstimate, MemberTaxEstimate, TaxBreakdown, TaxInput } from '@nest/tax'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionRow } from '../hooks/useDeductions'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { SuperCapSummary } from '../lib/tax'
import { makeMember } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { EofyScreen } from './EofyScreen'

function makeBreakdown(overrides: Partial<TaxBreakdown> = {}): TaxBreakdown {
  return {
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
    ...overrides,
  }
}

function makeMemberEstimate(overrides: Partial<MemberTaxEstimate> = {}): MemberTaxEstimate {
  return {
    memberId: 'm1',
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
    breakdown: makeBreakdown(),
    input: {} as TaxInput,
    ...overrides,
  }
}

function makeEstimate(members: MemberTaxEstimate[] = []): HouseholdTaxEstimate {
  return {
    members,
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
}

function makeCapSummary(overrides: Partial<SuperCapSummary> = {}): SuperCapSummary {
  return {
    concessionalCents: 0,
    concessionalCapCents: 30_000_00,
    concessionalOverCap: false,
    nonConcessionalCents: 0,
    nonConcessionalCapCents: 120_000_00,
    nonConcessionalOverCap: false,
    coContributionCents: 0,
    ...overrides,
  }
}

function makeHelpDebt(overrides: Partial<HelpDebt> = {}): HelpDebt {
  return {
    id: 'hd1',
    household_id: 'h1',
    member_id: 'm1',
    balance_cents: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makeDeduction(overrides: Partial<DeductionRow> = {}): DeductionRow {
  return {
    id: 'd1',
    household_id: 'h1',
    member_id: 'm1',
    financial_year: 2027,
    description: 'Home office',
    amount_cents: 300_00,
    deduction_date: '2026-09-01',
    basis: 'amount',
    distance_km: null,
    group_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makeReceipt(overrides: Partial<DeductionReceiptRow> = {}): DeductionReceiptRow {
  return {
    id: 'r1',
    household_id: 'h1',
    deduction_id: 'd1',
    storage_path: 'h1/d1/receipt.pdf',
    file_name: 'receipt.pdf',
    created_at: '',
    ...overrides,
  }
}

function renderScreen(props: Partial<Parameters<typeof EofyScreen>[0]> = {}) {
  return render(
    <MemoryRouter>
      <EofyScreen
        members={[makeMember({ id: 'm1', name: 'Alex' })]}
        financialYear={2027}
        availableFinancialYears={[2027, 2026]}
        onFinancialYearChange={vi.fn()}
        estimate={makeEstimate()}
        capSummaries={new Map()}
        helpDebts={[]}
        helpPayoff={new Map()}
        deductions={[]}
        payslipCounts={new Map()}
        receipts={[]}
        signedUrl={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('EofyScreen', () => {
  it('titles the page with the selected financial year', () => {
    renderScreen({ financialYear: 2027 })
    expect(screen.getByRole('heading', { name: /EOFY summary \(FY2027\)/ })).toBeInTheDocument()
  })

  it('offers every available financial year and reports a change', async () => {
    const onFinancialYearChange = vi.fn()
    const user = userEvent.setup()
    renderScreen({
      financialYear: 2027,
      availableFinancialYears: [2027, 2026],
      onFinancialYearChange,
    })

    await user.click(screen.getByRole('combobox', { name: /financial year/i }))
    await user.click(await screen.findByRole('option', { name: 'FY2026' }))

    expect(onFinancialYearChange).toHaveBeenCalledWith(2026)
  })

  it("renders a member's condensed tax figures", () => {
    renderScreen({
      estimate: makeEstimate([
        makeMemberEstimate({
          memberId: 'm1',
          annualAfterTaxCents: 700_000_00,
          breakdown: makeBreakdown({
            taxableIncomeCents: 1_000_000_00,
            incomeTaxCents: 250_000_00,
            litoOffsetCents: 0,
            medicareLevyCents: 20_000_00,
            medicareLevySurchargeCents: 5_000_00,
            helpRepaymentCents: 30_000_00,
            division293Cents: 1_000_00,
            totalLiabilityCents: 306_000_00,
          }),
        }),
      ]),
    })

    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText('Taxable income')).toBeInTheDocument()
    expect(within(card).getByText('$1,000,000.00')).toBeInTheDocument()
    expect(within(card).getByText('Medicare levy surcharge')).toBeInTheDocument()
    expect(within(card).getByText('Division 293 tax')).toBeInTheDocument()
    expect(within(card).getByText('Total tax liability')).toBeInTheDocument()
    expect(within(card).getByText('Net take-home')).toBeInTheDocument()
    expect(within(card).getByText('$700,000.00')).toBeInTheDocument()
  })

  it('omits the surcharge and Division 293 lines when neither applies', () => {
    renderScreen({
      estimate: makeEstimate([makeMemberEstimate({ memberId: 'm1' })]),
    })
    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).queryByText('Medicare levy surcharge')).not.toBeInTheDocument()
    expect(within(card).queryByText('Division 293 tax')).not.toBeInTheDocument()
  })

  it('shows an empty state for a member with no income to estimate', () => {
    renderScreen({ estimate: makeEstimate([]) })
    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText(/no income to estimate yet/i)).toBeInTheDocument()
  })

  it("shows the year's withholding position and how many payslips it came from", () => {
    renderScreen({
      estimate: makeEstimate([
        makeMemberEstimate({
          memberId: 'm1',
          breakdown: makeBreakdown({
            totalLiabilityCents: 25_000_00,
            paygWithheldCents: 30_000_00,
            balanceCents: -5_000_00,
          }),
        }),
      ]),
      payslipCounts: new Map([['m1', 3]]),
    })

    const card = screen.getByRole('region', { name: 'Alex' })
    expect(card).toHaveTextContent('Withheld so far $30,000.00 of $25,000.00 estimated tax.')
    expect(card).toHaveTextContent('Tracking toward a $5,000.00 refund.')
    expect(card).toHaveTextContent('Withholding summed from 3 payslips.')
  })

  it('reports a bill from a single slip that withheld nothing', () => {
    renderScreen({
      estimate: makeEstimate([
        makeMemberEstimate({
          memberId: 'm1',
          breakdown: makeBreakdown({
            totalLiabilityCents: 25_000_00,
            paygWithheldCents: 0,
            balanceCents: 25_000_00,
          }),
        }),
      ]),
      payslipCounts: new Map([['m1', 1]]),
    })

    const card = screen.getByRole('region', { name: 'Alex' })
    expect(card).toHaveTextContent('Tracking toward a $25,000.00 bill.')
    expect(card).toHaveTextContent('Withholding summed from 1 payslip.')
  })

  it('says a member recorded no payslips rather than showing nothing withheld', () => {
    renderScreen({
      financialYear: 2027,
      estimate: makeEstimate([
        makeMemberEstimate({
          memberId: 'm1',
          breakdown: makeBreakdown({
            totalLiabilityCents: 25_000_00,
            balanceCents: 25_000_00,
          }),
        }),
      ]),
      payslipCounts: new Map(),
    })

    const card = screen.getByRole('region', { name: 'Alex' })
    expect(
      within(card).getByText(/No payslips recorded for FY2027, so no withholding is netted/),
    ).toBeInTheDocument()
    expect(within(card).queryByText(/withheld so far/i)).toBeNull()
    expect(within(card).queryByText(/tracking toward/i)).toBeNull()
  })

  it("lists a member's claimed deductions with their total and receipts", async () => {
    const signedUrl = vi.fn().mockResolvedValue('https://example.com/receipt.pdf')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()

    renderScreen({
      deductions: [makeDeduction({ id: 'd1', member_id: 'm1', amount_cents: 300_00 })],
      receipts: [makeReceipt({ id: 'r1', deduction_id: 'd1', file_name: 'invoice.pdf' })],
      signedUrl,
    })

    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText('Total deductions claimed')).toBeInTheDocument()
    // The total and the single deduction's amount are both $300.00.
    expect(within(card).getAllByText('$300.00')).toHaveLength(2)
    expect(within(card).getByText('Home office')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'invoice.pdf' }))
    expect(signedUrl).toHaveBeenCalledWith('h1/d1/receipt.pdf')

    openSpy.mockRestore()
  })

  it('shows an empty state when a member has no deductions', () => {
    renderScreen({ deductions: [] })
    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText(/no deductions claimed/i)).toBeInTheDocument()
  })

  it('shows the super cap summary and warns when over the concessional cap', () => {
    renderScreen({
      capSummaries: new Map([
        [
          'm1',
          makeCapSummary({
            concessionalCents: 35_000_00,
            concessionalCapCents: 30_000_00,
            concessionalOverCap: true,
          }),
        ],
      ]),
    })
    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText(/over the concessional cap/i)).toBeInTheDocument()
  })

  it('shows an empty state when a member has no super contributions', () => {
    renderScreen({ capSummaries: new Map() })
    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText(/no super contributions recorded/i)).toBeInTheDocument()
  })

  it("shows a member's standing HELP balance and this year's estimated repayment", () => {
    renderScreen({
      helpDebts: [makeHelpDebt({ member_id: 'm1', balance_cents: 20_000_00 })],
      estimate: makeEstimate([
        makeMemberEstimate({
          memberId: 'm1',
          breakdown: makeBreakdown({ helpRepaymentCents: 2_000_00 }),
        }),
      ]),
    })
    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText('Standing HELP balance')).toBeInTheDocument()
    expect(within(card).getByText('$20,000.00')).toBeInTheDocument()
    expect(within(card).getByText(/Estimated FY2027 repayment/)).toBeInTheDocument()
  })

  it('shows an empty state when a member has no HELP debt', () => {
    renderScreen({ helpDebts: [] })
    const card = screen.getByRole('region', { name: 'Alex' })
    expect(within(card).getByText(/no help\/hecs debt on file/i)).toBeInTheDocument()
  })

  it('links out to the Tax, Payslips, Deductions, Super, and HELP debt tabs', () => {
    renderScreen()
    expect(screen.getByRole('link', { name: 'Tax' })).toHaveAttribute('href', '/tax')
    expect(screen.getByRole('link', { name: 'Payslips' })).toHaveAttribute('href', '/payslips')
    expect(screen.getByRole('link', { name: 'Deductions' })).toHaveAttribute('href', '/deductions')
    expect(screen.getByRole('link', { name: 'Super' })).toHaveAttribute('href', '/super')
    expect(screen.getByRole('link', { name: 'HELP debt' })).toHaveAttribute('href', '/help-debt')
  })

  it('shows an empty state when the household has no members', () => {
    renderScreen({ members: [] })
    expect(screen.getByText(/no household members yet/i)).toBeInTheDocument()
  })
})
