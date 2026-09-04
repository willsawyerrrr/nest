import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { HouseholdTaxEstimate } from '@nest/tax'
import type { EofyShareData, EofyShareOutcome } from '../hooks/useEofyShareData'
import { render, screen } from '../test/render'
import { EofyShareSection } from './EofyShareSection'

const hooks = vi.hoisted(() => ({
  useEofyShareData: vi.fn(),
  invoke: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useEofyShareData', () => ({ useEofyShareData: hooks.useEofyShareData }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: hooks.invoke } } }))
vi.mock('../components/EofyScreen', () => ({
  EofyScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="eofy-screen" />
  },
}))

function renderAt(entry = '/share/eofy/a-token') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/share/eofy/:token" element={<EofyShareSection />} />
      </Routes>
    </MemoryRouter>,
  )
}
const shareData: EofyShareData = {
  financialYear: 2027,
  members: [{ id: 'm1', name: 'Alex', date_of_birth: null }],
  inflows: [],
  taxProfiles: [],
  superContributions: [],
  superProfiles: [],
  helpDebts: [],
  deductions: [],
  deductionReceipts: [],
  payslips: [],
  savingsGoals: [],
  accounts: [],
}

describe('EofyShareSection', () => {
  it('shows the loading screen while the share data loads', () => {
    hooks.useEofyShareData.mockReturnValue({ status: 'loading' } satisfies EofyShareOutcome)
    renderAt()
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the error message for an invalid or expired share', () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'error',
      message: 'This share link is invalid or has expired.',
    } satisfies EofyShareOutcome)
    renderAt()
    expect(screen.getByText('This share link is invalid or has expired.')).toBeInTheDocument()
    expect(screen.queryByTestId('eofy-screen')).not.toBeInTheDocument()
  })

  it('renders EofyScreen with the shared data, tab links off, and a disclaimer note', () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'ready',
      data: shareData,
    } satisfies EofyShareOutcome)
    renderAt()

    expect(screen.getByTestId('eofy-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual(shareData.members)
    expect(hooks.screenProps?.financialYear).toBe(2027)
    expect(hooks.screenProps?.availableFinancialYears).toEqual([2027])
    expect(hooks.screenProps?.showTabLinks).toBe(false)
    expect(hooks.screenProps?.disclaimerNote).toEqual(
      'These figures are estimates for planning purposes, not a filed tax return.',
    )
    expect((hooks.screenProps!.estimate as HouseholdTaxEstimate).members).toEqual([])
  })

  it('feeds a shared goal’s projected savings interest into the estimate', () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'ready',
      data: {
        ...shareData,
        members: [{ id: 'm1', name: 'Alex', date_of_birth: null }],
        inflows: [
          {
            id: 'i1',
            household_id: 'h1',
            member_id: 'm1',
            name: 'Job',
            taxable: true,
            attracts_super: true,
            type: 'salary',
            schedule: 'annual',
            interval_count: null,
            pay_schedule: null,
            pay_interval_count: null,
            arrives_every_pay_period: true,
            amount_cents: 120_000_00,
            hourly_rate_cents: null,
            hours_per_period: null,
            starts_on: null,
            ends_on: null,
            paid_on: null,
            one_off_tax_treatment: null,
            years_of_service: null,
            is_joint: false,
            member_split_percent: null,
            created_at: '',
            updated_at: '',
          },
        ],
        savingsGoals: [
          {
            id: 'g1',
            household_id: 'h1',
            name: 'House',
            target_amount_cents: 1_000_000_00,
            target_date: null,
            current_balance_cents: 100_000_00,
            linked_account_id: null,
            annual_interest_bps: 450,
            created_at: '',
            updated_at: '',
          },
        ],
      },
    } satisfies EofyShareOutcome)
    renderAt()

    const member = (hooks.screenProps!.estimate as HouseholdTaxEstimate).members[0]!
    // $4,500 of projected interest (4.5% of $100,000) on top of the $120,000 salary.
    expect(member.annualGrossCents).toBe(124_500_00)
  })

  it('passes a no-op onFinancialYearChange, since the share is fixed to one year', () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'ready',
      data: shareData,
    } satisfies EofyShareOutcome)
    renderAt()

    const onFinancialYearChange = hooks.screenProps?.onFinancialYearChange as (
      financialYear: number,
    ) => void
    expect(() => onFinancialYearChange(2026)).not.toThrow()
  })

  it('passes payslip documents built from payslips with an attached file', () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'ready',
      data: {
        ...shareData,
        payslips: [
          {
            id: 'ps1',
            household_id: 'h1',
            member_id: 'm1',
            financial_year: 2027,
            period_start: '2026-07-01',
            period_end: '2026-07-14',
            paid_on: '2026-07-15',
            gross_cents: 0,
            tax_withheld_cents: 0,
            super_cents: 0,
            net_cents: 0,
            salary_sacrifice_cents: null,
            ytd_gross_cents: null,
            ytd_tax_withheld_cents: null,
            ytd_super_cents: null,
            file_path: 'h1/ps1/x.pdf',
            note: null,
            created_at: '',
            updated_at: '',
          },
          {
            id: 'ps2',
            household_id: 'h1',
            member_id: 'm1',
            financial_year: 2027,
            period_start: '2026-07-15',
            period_end: '2026-07-28',
            paid_on: '2026-07-29',
            gross_cents: 0,
            tax_withheld_cents: 0,
            super_cents: 0,
            net_cents: 0,
            salary_sacrifice_cents: null,
            ytd_gross_cents: null,
            ytd_tax_withheld_cents: null,
            ytd_super_cents: null,
            file_path: null,
            note: null,
            created_at: '',
            updated_at: '',
          },
        ],
      },
    } satisfies EofyShareOutcome)
    renderAt()

    expect(hooks.screenProps?.payslipDocuments).toEqual([
      { id: 'ps1', memberId: 'm1', paidOn: '2026-07-15', filePath: 'h1/ps1/x.pdf' },
    ])
  })

  it("signedUrl resolves a receipt through eofy-share-file with the route's token", async () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'ready',
      data: shareData,
    } satisfies EofyShareOutcome)
    hooks.invoke.mockResolvedValue({ data: { url: 'https://example.com/signed' }, error: null })
    renderAt('/share/eofy/the-token')

    const signedUrl = hooks.screenProps?.signedUrl as (path: string) => Promise<string | null>
    await expect(signedUrl('h1/d1/receipt.pdf')).resolves.toBe('https://example.com/signed')
    expect(hooks.invoke).toHaveBeenCalledWith('eofy-share-file', {
      body: { token: 'the-token', bucket: 'receipts', path: 'h1/d1/receipt.pdf' },
    })
  })

  it('payslipSignedUrl resolves a payslip document through eofy-share-file', async () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'ready',
      data: shareData,
    } satisfies EofyShareOutcome)
    hooks.invoke.mockResolvedValue({ data: { url: 'https://example.com/payslip' }, error: null })
    renderAt('/share/eofy/the-token')

    const payslipSignedUrl = hooks.screenProps?.payslipSignedUrl as (
      path: string,
    ) => Promise<string | null>
    await expect(payslipSignedUrl('h1/ps1/x.pdf')).resolves.toBe('https://example.com/payslip')
    expect(hooks.invoke).toHaveBeenCalledWith('eofy-share-file', {
      body: { token: 'the-token', bucket: 'payslips', path: 'h1/ps1/x.pdf' },
    })
  })

  it('signedUrl resolves to null on an eofy-share-file error or missing data', async () => {
    hooks.useEofyShareData.mockReturnValue({
      status: 'ready',
      data: shareData,
    } satisfies EofyShareOutcome)
    renderAt()
    const signedUrl = hooks.screenProps?.signedUrl as (path: string) => Promise<string | null>

    hooks.invoke.mockResolvedValue({ data: null, error: new Error('not found') })
    await expect(signedUrl('h1/d1/receipt.pdf')).resolves.toBeNull()

    hooks.invoke.mockResolvedValue({ data: null, error: null })
    await expect(signedUrl('h1/d1/receipt.pdf')).resolves.toBeNull()
  })
})
