import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { financialYearForDate, type HouseholdTaxEstimate } from '@nest/tax'
import { makeInflow, makePayslip } from '../test/fixtures'
import { render, screen } from '../test/render'
import { EofySection } from './EofySection'
import { TaxSection } from './TaxSection'

// The real `configsByYear` publishes only FY2027 today, so a plain import
// would never exercise the descending sort with more than one entry. A second
// year is layered on here (reusing FY2027's config, since only the year keys
// matter for this) so `AVAILABLE_FINANCIAL_YEARS`'s sort comparator runs.
const { extendedConfigsByYear } = await vi.hoisted(async () => {
  const actual = await vi.importActual<typeof import('@nest/tax')>('@nest/tax')
  const [firstConfig] = Object.values(actual.configsByYear)
  return { extendedConfigsByYear: { ...actual.configsByYear, 2025: firstConfig! } }
})

vi.mock('@nest/tax', async () => {
  const actual = await vi.importActual<typeof import('@nest/tax')>('@nest/tax')
  return { ...actual, configsByYear: extendedConfigsByYear }
})

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useInflows: vi.fn(),
  useTaxProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useSuperProfiles: vi.fn(),
  useHelpDebts: vi.fn(),
  useDeductions: vi.fn(),
  useDeductionReceipts: vi.fn(),
  usePayslips: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
  taxViewProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useSuperProfiles', () => ({ useSuperProfiles: hooks.useSuperProfiles }))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../hooks/useDeductionReceipts', () => ({
  useDeductionReceipts: hooks.useDeductionReceipts,
}))
vi.mock('../hooks/usePayslips', () => ({ usePayslips: hooks.usePayslips }))
vi.mock('../components/EofyScreen', () => ({
  EofyScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="eofy-screen" />
  },
}))
// The Tax tab is rendered from the same mocked hooks to hold its estimate against
// the EOFY tab's for identical rows.
vi.mock('../components/TaxEstimateView', () => ({
  TaxEstimateView: (props: Record<string, unknown>) => {
    hooks.taxViewProps = props
    return <div data-testid="tax-view" />
  },
}))

const currentFy = financialYearForDate(new Date())

function mockLoaded() {
  hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
  hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
  hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: currentFy })
  hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
  hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
  hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
  hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
  hooks.useDeductionReceipts.mockReturnValue({ loading: false, receipts: [], signedUrl: vi.fn() })
  hooks.usePayslips.mockReturnValue({ loading: false, payslips: [] })
}

/** The member estimate the mocked screen was handed, which every test has one of. */
function memberEstimate(props: Record<string, unknown> | null) {
  return (props!.estimate as HouseholdTaxEstimate).members[0]!
}

describe('EofySection', () => {
  it('shows the loading screen until every hook has loaded', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useInflows.mockReturnValue({ loading: false })
    hooks.useTaxProfiles.mockReturnValue({ loading: false })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useSuperProfiles.mockReturnValue({ loading: false })
    hooks.useHelpDebts.mockReturnValue({ loading: false })
    hooks.useDeductions.mockReturnValue({ loading: false })
    hooks.useDeductionReceipts.mockReturnValue({ loading: false })
    hooks.usePayslips.mockReturnValue({ loading: false })
    render(<EofySection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it("waits for the selected year's payslips before estimating", () => {
    mockLoaded()
    hooks.usePayslips.mockReturnValue({ loading: true, payslips: null })
    render(<EofySection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('defaults to the current financial year and scopes every FY hook to it', () => {
    mockLoaded()
    render(<EofySection householdId="h1" />)
    expect(screen.getByTestId('eofy-screen')).toBeInTheDocument()

    expect(hooks.useTaxProfiles).toHaveBeenCalledWith('h1', currentFy)
    expect(hooks.useSuperContributions).toHaveBeenCalledWith('h1', currentFy)
    expect(hooks.useSuperProfiles).toHaveBeenCalledWith('h1', currentFy)
    expect(hooks.useDeductions).toHaveBeenCalledWith('h1', currentFy)
    expect(hooks.usePayslips).toHaveBeenCalledWith('h1', currentFy)
    expect(hooks.useHelpDebts).toHaveBeenCalledWith('h1')

    expect(hooks.screenProps?.financialYear).toBe(currentFy)
    // Descending order, so the extra 2025 config sorts after the real FY2027.
    expect(hooks.screenProps?.availableFinancialYears).toEqual(
      Object.keys(extendedConfigsByYear)
        .map(Number)
        .sort((a, b) => b - a),
    )
  })

  it('re-scopes every FY hook when the selected financial year changes', () => {
    mockLoaded()
    render(<EofySection householdId="h1" />)

    const onFinancialYearChange = hooks.screenProps?.onFinancialYearChange as (
      financialYear: number,
    ) => void
    act(() => onFinancialYearChange(2025))

    expect(hooks.useTaxProfiles).toHaveBeenCalledWith('h1', 2025)
    expect(hooks.useSuperContributions).toHaveBeenCalledWith('h1', 2025)
    expect(hooks.useSuperProfiles).toHaveBeenCalledWith('h1', 2025)
    expect(hooks.useDeductions).toHaveBeenCalledWith('h1', 2025)
    expect(hooks.usePayslips).toHaveBeenCalledWith('h1', 2025)
    expect(hooks.screenProps?.financialYear).toBe(2025)
  })

  it("nets the selected year's withheld tax against the estimate", () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })
    hooks.usePayslips.mockReturnValue({
      loading: false,
      payslips: [
        makePayslip({ id: 'ps1', tax_withheld_cents: 18_000_00 }),
        makePayslip({ id: 'ps2', tax_withheld_cents: 12_000_00 }),
      ],
    })

    render(<EofySection householdId="h1" />)

    const member = memberEstimate(hooks.screenProps)
    expect(member.breakdown.paygWithheldCents).toBe(30_000_00)
    expect(member.breakdown.balanceCents).toBe(member.breakdown.totalLiabilityCents - 30_000_00)
    expect(hooks.screenProps?.payslipCounts).toEqual(new Map([['m1', 2]]))
  })

  it('reports no payslips for a year with none, leaving the estimate unoffset', () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })

    render(<EofySection householdId="h1" />)

    const member = memberEstimate(hooks.screenProps)
    expect(member.breakdown.paygWithheldCents).toBe(0)
    expect(member.breakdown.balanceCents).toBe(member.breakdown.totalLiabilityCents)
    expect(hooks.screenProps?.payslipCounts).toEqual(new Map())
  })

  it('counts only the selected year’s slips when the year changes', () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })
    hooks.usePayslips.mockImplementation((_householdId: string, financialYear: number) => ({
      loading: false,
      // Stands in for the hook's own `financial_year` filter: only FY2027 has slips.
      payslips: financialYear === currentFy ? [makePayslip({ tax_withheld_cents: 30_000_00 })] : [],
    }))

    render(<EofySection householdId="h1" />)
    expect(memberEstimate(hooks.screenProps).breakdown.paygWithheldCents).toBe(30_000_00)

    const onFinancialYearChange = hooks.screenProps?.onFinancialYearChange as (
      financialYear: number,
    ) => void
    act(() => onFinancialYearChange(2025))

    expect(memberEstimate(hooks.screenProps).breakdown.paygWithheldCents).toBe(0)
    expect(hooks.screenProps?.payslipCounts).toEqual(new Map())
  })

  it('reports the same refund or bill as the Tax tab for the same rows', () => {
    mockLoaded()
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })
    hooks.usePayslips.mockReturnValue({
      loading: false,
      payslips: [makePayslip({ tax_withheld_cents: 30_000_00 })],
    })

    render(<EofySection householdId="h1" />)
    render(<TaxSection householdId="h1" />)

    const eofy = memberEstimate(hooks.screenProps).breakdown
    const tax = memberEstimate(hooks.taxViewProps).breakdown
    expect(eofy.paygWithheldCents).toBe(tax.paygWithheldCents)
    expect(eofy.balanceCents).toBe(tax.balanceCents)
    // Not a pair of zeroes agreeing: the withholding really did move the balance.
    expect(eofy.balanceCents).toBe(eofy.totalLiabilityCents - 30_000_00)
  })

  it("filters deduction receipts to the selected FY's loaded deductions", () => {
    mockLoaded()
    hooks.useDeductions.mockReturnValue({
      loading: false,
      deductions: [{ id: 'd1', member_id: 'm1', amount_cents: 100_00 }],
    })
    hooks.useDeductionReceipts.mockReturnValue({
      loading: false,
      receipts: [
        { id: 'r1', deduction_id: 'd1', file_name: 'a.pdf', storage_path: 'p1' },
        { id: 'r2', deduction_id: 'other-fy-deduction', file_name: 'b.pdf', storage_path: 'p2' },
      ],
      signedUrl: vi.fn(),
    })

    render(<EofySection householdId="h1" />)

    expect(hooks.screenProps?.receipts).toEqual([
      { id: 'r1', deduction_id: 'd1', file_name: 'a.pdf', storage_path: 'p1' },
    ])
  })

  it('passes only payslips with an attached document as payslip documents, using usePayslips.signedUrl', () => {
    mockLoaded()
    const signedUrl = vi.fn()
    hooks.usePayslips.mockReturnValue({
      loading: false,
      signedUrl,
      payslips: [
        makePayslip({
          id: 'ps1',
          member_id: 'm1',
          paid_on: '2027-01-15',
          file_path: 'h1/ps1/x.pdf',
        }),
        makePayslip({ id: 'ps2', member_id: 'm1', paid_on: '2027-02-01', file_path: null }),
      ],
    })

    render(<EofySection householdId="h1" />)

    expect(hooks.screenProps?.payslipDocuments).toEqual([
      { id: 'ps1', memberId: 'm1', paidOn: '2027-01-15', filePath: 'h1/ps1/x.pdf' },
    ])
    expect(hooks.screenProps?.payslipSignedUrl).toBe(signedUrl)
  })
})
