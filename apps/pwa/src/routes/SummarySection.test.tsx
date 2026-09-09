import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeBudgetLine,
  makeGiftDiscretionaryBudget,
  makeGoal,
  makeInflow,
  makeSaver,
  makeTaxProfile,
} from '../test/fixtures'
import { render, screen } from '../test/render'
import { SummarySection } from './SummarySection'

afterEach(() => vi.useRealTimers())

const hooks = vi.hoisted(() => ({
  useInflows: vi.fn(),
  useTaxProfiles: vi.fn(),
  useBudgetLines: vi.fn(),
  useTemporaryItems: vi.fn(),
  useSuperContributions: vi.fn(),
  useGifts: vi.fn(),
  useBreakdowns: vi.fn(),
  useHelpDebts: vi.fn(),
  useDeductions: vi.fn(),
  useMembers: vi.fn(),
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
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useBudgetLines', () => ({ useBudgetLines: hooks.useBudgetLines }))
vi.mock('../hooks/useTemporaryItems', () => ({ useTemporaryItems: hooks.useTemporaryItems }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../hooks/useBreakdowns', () => ({ useBreakdowns: hooks.useBreakdowns }))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useGoals', () => ({ useGoals: hooks.useGoals }))
vi.mock('../hooks/useSavers', () => ({ useSavers: hooks.useSavers }))
vi.mock('../components/SummaryView', () => ({
  SummaryView: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="summary-view" />
  },
}))

describe('SummarySection', () => {
  beforeEach(() => {
    hooks.useGoals.mockReturnValue({ loading: false, goals: [], baselineGoals: [] })
    hooks.useSavers.mockReturnValue({ loading: false, savers: [] })
  })

  it('shows the loading screen until data loads', () => {
    hooks.useInflows.mockReturnValue({ loading: true })
    hooks.useTaxProfiles.mockReturnValue({ loading: false })
    hooks.useBudgetLines.mockReturnValue({ loading: false })
    hooks.useTemporaryItems.mockReturnValue({ loading: false })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useGifts.mockReturnValue({ loading: false })
    hooks.useBreakdowns.mockReturnValue({ loading: false })
    hooks.useHelpDebts.mockReturnValue({ loading: false })
    hooks.useDeductions.mockReturnValue({ loading: false })
    hooks.useMembers.mockReturnValue({ loading: false, members: [] })
    render(<SummarySection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the summary view from the computed plan', () => {
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [] })
    hooks.useTemporaryItems.mockReturnValue({ loading: false, items: [] })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useGifts.mockReturnValue({ loading: false, budgets: [] })
    hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [], items: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.useMembers.mockReturnValue({ loading: false, members: [] })
    render(<SummarySection />)
    expect(screen.getByTestId('summary-view')).toBeInTheDocument()
    expect(hooks.screenProps).toHaveProperty('summary')
    expect(hooks.screenProps).not.toHaveProperty('baseline')
  })

  it('bases the fortnightly buffer on the income landing now, keeping the annual whole-year', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'))
    const salary = {
      id: 'i1',
      household_id: 'h1',
      name: 'Old job',
      taxable: true,
      attracts_super: true,
      member_id: 'm1',
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
      ends_on: '2026-09-30',
      paid_on: null,
      one_off_tax_treatment: null,
      years_of_service: null,
      created_at: '',
      updated_at: '',
    }
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [salary] })
    hooks.useTaxProfiles.mockReturnValue({
      loading: false,
      profiles: [
        {
          id: 'p1',
          household_id: 'h1',
          member_id: 'm1',
          financial_year: 2027,
          residency: 'resident',
          has_private_hospital_cover: false,
          created_at: '',
          updated_at: '',
        },
      ],
      financialYear: 2027,
    })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [] })
    hooks.useTemporaryItems.mockReturnValue({ loading: false, items: [] })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useGifts.mockReturnValue({ loading: false, budgets: [] })
    hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [], items: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.useMembers.mockReturnValue({ loading: false, members: [] })
    render(<SummarySection />)

    const summary = hooks.screenProps?.summary as {
      available: { fortnightlyCents: number; annualCents: number }
    }
    // The salary ended well before now, so nothing lands this fortnight...
    expect(summary.available.fortnightlyCents).toBe(0)
    // ...while the annual figure keeps the whole-year estimate's part-year income.
    expect(summary.available.annualCents).toBeGreaterThan(0)
  })

  it('counts a goal’s projected savings interest in the after-tax income', () => {
    const setup = () => {
      hooks.useInflows.mockReturnValue({
        loading: false,
        inflows: [makeInflow({ schedule: 'annual', amount_cents: 120_000_00 })],
      })
      hooks.useTaxProfiles.mockReturnValue({
        loading: false,
        profiles: [makeTaxProfile()],
        financialYear: 2027,
      })
      hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [] })
      hooks.useTemporaryItems.mockReturnValue({ loading: false, items: [] })
      hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
      hooks.useGifts.mockReturnValue({ loading: false, budgets: [] })
      hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [], items: [] })
      hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
      hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
      hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Alex' }] })
    }
    const availableAnnual = () =>
      (hooks.screenProps!.summary as { available: { annualCents: number } }).available.annualCents

    setup()
    render(<SummarySection />)
    const withoutInterest = availableAnnual()

    setup()
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [makeGoal({ current_balance_cents: 50_000_00, annual_interest_bps: 400 })],
      baselineGoals: [],
    })
    hooks.useSavers.mockReturnValue({ loading: false, savers: [makeSaver()] })
    render(<SummarySection />)

    // $2,000 more assessable income lifts after-tax income, by less than the full $2,000.
    expect(availableAnnual()).toBeGreaterThan(withoutInterest)
    expect(availableAnnual()).toBeLessThan(withoutInterest + 2_000_00)
  })

  it('folds the ad hoc gift buffer into the external gift line, matching the Budget tab', () => {
    const externalGiftLine = makeBudgetLine({
      id: 'bl-gifts',
      name: 'Gifts (others)',
      line_group: 'wants',
      amount_cents: 0,
      frequency: 'annual',
      is_gift_line: true,
      gift_recipient_member_id: null,
    })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [externalGiftLine] })
    hooks.useTemporaryItems.mockReturnValue({ loading: false, items: [] })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useGifts.mockReturnValue({
      loading: false,
      budgets: [],
      recipients: [],
      discretionaryBudget: makeGiftDiscretionaryBudget({ budgeted_amount_cents: 500_00 }),
    })
    hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [], items: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.useMembers.mockReturnValue({ loading: false, members: [] })
    render(<SummarySection />)

    const summary = hooks.screenProps?.summary as {
      groups: { wants: { annualCents: number } }
    }
    // The $500/year buffer is the whole of the derived "Gifts (others)" line.
    expect(summary.groups.wants.annualCents).toBe(500_00)
  })

  it('also computes a baseline reconciliation while planning mode is active', () => {
    hooks.planningActive = true
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [], baselineInflows: [] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [], baselineLines: [] })
    hooks.useTemporaryItems.mockReturnValue({ loading: false, items: [] })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useGifts.mockReturnValue({ loading: false, budgets: [] })
    hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [], items: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
    hooks.useMembers.mockReturnValue({ loading: false, members: [] })
    render(<SummarySection />)
    hooks.planningActive = false

    expect(hooks.screenProps).toHaveProperty('baseline')
  })
})
