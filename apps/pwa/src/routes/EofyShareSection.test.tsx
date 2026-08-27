import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { HouseholdTaxEstimate } from '@nest/tax'
import type { EofyShareData, EofyShareOutcome } from '../hooks/useEofyShareData'
import { render, screen } from '../test/render'
import { EofyShareSection } from './EofyShareSection'

const hooks = vi.hoisted(() => ({
  useEofyShareData: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useEofyShareData', () => ({ useEofyShareData: hooks.useEofyShareData }))
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
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
        ],
      },
    } satisfies EofyShareOutcome)
    renderAt()

    expect(hooks.screenProps?.payslipDocuments).toEqual([
      { id: 'ps1', memberId: 'm1', paidOn: '2026-07-15', filePath: 'h1/ps1/x.pdf' },
    ])
  })
})
