import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HouseholdTaxEstimate } from '@nest/tax'
import { estimateHouseholdTaxFromRows } from '../lib/tax'
import { makeGoal, makeInflow, makePayslip } from '../test/fixtures'
import { render, screen } from '../test/render'
import { TaxSection } from './TaxSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useInflows: vi.fn(),
  useTaxProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useSuperProfiles: vi.fn(),
  useHelpDebts: vi.fn(),
  useDeductions: vi.fn(),
  usePayslips: vi.fn(),
  useGoals: vi.fn(),
  useSavers: vi.fn(),
  planningActive: false,
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../components/PlanningModeProvider', () => ({
  usePlanningMode: () => ({ active: hooks.planningActive }),
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
vi.mock('../hooks/usePayslips', () => ({ usePayslips: hooks.usePayslips }))
vi.mock('../hooks/useGoals', () => ({ useGoals: hooks.useGoals }))
vi.mock('../hooks/useSavers', () => ({ useSavers: hooks.useSavers }))
vi.mock('../components/TaxEstimateView', () => ({
  TaxEstimateView: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="tax-view" />
  },
}))

describe('TaxSection', () => {
  beforeEach(() => {
    hooks.useGoals.mockReturnValue({ loading: false, goals: [], baselineGoals: [] })
    hooks.useSavers.mockReturnValue({ loading: false, savers: [] })
  })

  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useInflows.mockReturnValue({ loading: false })
    hooks.useTaxProfiles.mockReturnValue({ loading: false })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useSuperProfiles.mockReturnValue({ loading: false })
    hooks.useHelpDebts.mockReturnValue({ loading: false })
    hooks.useDeductions.mockReturnValue({ loading: false })
    hooks.usePayslips.mockReturnValue({ loading: false })
    render(<TaxSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the tax view and resolves member names', () => {
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useSuperProfiles.mockReturnValue({
      loading: false,
      profiles: [{ member_id: 'm1', carry_forward_cap_cents: 0 }],
    })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.usePayslips.mockReturnValue({ loading: false, payslips: [] })
    render(<TaxSection />)
    expect(screen.getByTestId('tax-view')).toBeInTheDocument()

    const memberName = hooks.screenProps?.memberName as (id: string) => string
    expect(memberName('m1')).toBe('Alex')
    expect(memberName('nope')).toBe('Unknown')
    expect(hooks.screenProps?.financialYear).toBe(2027)

    const concessionalCapCentsByMember = hooks.screenProps?.concessionalCapCentsByMember as Map<
      string,
      number
    >
    expect(concessionalCapCentsByMember.get('m1')).toBeGreaterThan(0)
  })

  it('nets each member’s payslip withholding against their estimated tax', () => {
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.usePayslips.mockReturnValue({
      loading: false,
      payslips: [makePayslip({ tax_withheld_cents: 30_000_00 })],
    })
    render(<TaxSection />)

    const estimate = hooks.screenProps?.estimate as HouseholdTaxEstimate
    const member = estimate.members[0]!
    expect(member.breakdown.paygWithheldCents).toBe(30_000_00)
    expect(member.breakdown.balanceCents).toBe(member.breakdown.totalLiabilityCents - 30_000_00)
  })

  it('passes a baseline estimate from the real inflows while planning mode is active', () => {
    hooks.planningActive = true
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [makeInflow({ amount_cents: 200_000_00 })],
      baselineInflows: [makeInflow({ amount_cents: 100_000_00 })],
    })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.usePayslips.mockReturnValue({ loading: false, payslips: [] })
    render(<TaxSection />)
    hooks.planningActive = false

    const estimate = hooks.screenProps?.estimate as HouseholdTaxEstimate
    const baseline = hooks.screenProps?.baseline as HouseholdTaxEstimate
    expect(baseline.annualGrossCents).toBeGreaterThan(0)
    expect(estimate.annualGrossCents).toBe(baseline.annualGrossCents * 2)
  })

  it('feeds a goal’s projected savings interest into the estimate and surfaces it per member', () => {
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.usePayslips.mockReturnValue({ loading: false, payslips: [] })
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [makeGoal({ current_balance_cents: 100_000_00, annual_interest_bps: 450 })],
      baselineGoals: [],
    })
    hooks.useSavers.mockReturnValue({ loading: false, savers: [] })
    render(<TaxSection />)

    const withInterest = hooks.screenProps?.estimate as HouseholdTaxEstimate
    const byMember = hooks.screenProps?.projectedInterestCentsByMember as Map<string, number>
    // 4.5% of $100,000, split across the single member.
    expect(byMember.get('m1')).toBe(4_500_00)
    expect(withInterest.members[0]!.annualGrossCents).toBe(
      estimateHouseholdTaxFromRows([makeInflow()], []).members[0]!.annualGrossCents + 4_500_00,
    )
  })

  it('leaves the estimate unoffset when no payslip has been entered', () => {
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [makeInflow()] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.usePayslips.mockReturnValue({ loading: false, payslips: [] })
    render(<TaxSection />)

    const estimate = hooks.screenProps?.estimate as HouseholdTaxEstimate
    const member = estimate.members[0]!
    expect(member.breakdown.paygWithheldCents).toBe(0)
    expect(member.breakdown.balanceCents).toBe(member.breakdown.totalLiabilityCents)
  })
})
