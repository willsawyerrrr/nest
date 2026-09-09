import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '../test/render'
import { NetWorthSection } from './NetWorthSection'

afterEach(() => localStorage.clear())

const hooks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  useSuperProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useInflows: vi.fn(),
  useHelpDebts: vi.fn(),
  useEquityGrants: vi.fn(),
  useTaxProfiles: vi.fn(),
  useDeductions: vi.fn(),
  useGoals: vi.fn(),
  useBudgetLines: vi.fn(),
  useMembers: vi.fn(),
  planningActive: false,
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../components/PlanningModeProvider', () => ({
  usePlanningMode: () => ({ active: hooks.planningActive }),
}))
vi.mock('../hooks/useAccounts', () => ({ useAccounts: hooks.useAccounts }))
vi.mock('../hooks/useSuperProfiles', () => ({ useSuperProfiles: hooks.useSuperProfiles }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../hooks/useEquityGrants', () => ({ useEquityGrants: hooks.useEquityGrants }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useDeductions', () => ({ useDeductions: hooks.useDeductions }))
vi.mock('../hooks/useGoals', () => ({ useGoals: hooks.useGoals }))
vi.mock('../hooks/useBudgetLines', () => ({ useBudgetLines: hooks.useBudgetLines }))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../components/NetWorthView', () => ({
  NetWorthView: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="net-worth-view" />
  },
}))

function mockLoaded() {
  hooks.useAccounts.mockReturnValue({ loading: false, accounts: [], update: vi.fn() })
  hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
  hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
  hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
  hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
  hooks.useEquityGrants.mockReturnValue({ loading: false, grants: [] })
  hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [], financialYear: 2027 })
  hooks.useDeductions.mockReturnValue({ loading: false, deductions: [] })
  hooks.useGoals.mockReturnValue({ loading: false, goals: [] })
  hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [] })
  hooks.useMembers.mockReturnValue({ loading: false, members: [] })
}

/** A taxable annual salary inflow, so employer SG produces a net super contribution. */
function salaryInflow() {
  return {
    id: 'i1',
    household_id: 'h1',
    member_id: 'm1',
    name: 'Salary',
    taxable: true,
    attracts_super: true,
    type: 'salary',
    schedule: 'annual',
    interval_count: null,
    amount_cents: 100_000_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    starts_on: null,
    ends_on: null,
    created_at: '',
    updated_at: '',
  }
}

/** A fully vested share grant fixture, valued at quantity × price per share. */
function vestedShareGrant(overrides: Record<string, unknown> = {}) {
  return {
    member_id: 'm1',
    label: 'Shares',
    instrument_type: 'share',
    quantity: 10,
    grant_date: '2020-01-01',
    cliff_months: 0,
    vesting_period_months: 1,
    vesting_frequency: 'monthly',
    strike_price_cents: null,
    price_per_share_cents: 5_00,
    ...overrides,
  }
}

describe('NetWorthSection', () => {
  it('shows the loading screen until data loads', () => {
    mockLoaded()
    hooks.useAccounts.mockReturnValue({ loading: true })
    render(<NetWorthSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the net-worth view with effective balances', () => {
    mockLoaded()
    render(<NetWorthSection />)
    expect(screen.getByTestId('net-worth-view')).toBeInTheDocument()
    expect(hooks.screenProps).toHaveProperty('accounts')
    expect(hooks.screenProps).toHaveProperty('superIds')
    expect(hooks.screenProps?.liabilities).toEqual([])
    expect(hooks.screenProps?.equity).toEqual([])
  })

  it('maps each grant with vested value to a named equity holding', () => {
    mockLoaded()
    hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Alex' }] })
    hooks.useEquityGrants.mockReturnValue({
      loading: false,
      grants: [
        vestedShareGrant({ member_id: 'm1', label: 'Shares' }),
        vestedShareGrant({ member_id: 'm9', label: 'Options' }),
        vestedShareGrant({ member_id: 'm1', label: 'Empty', quantity: 0 }),
      ],
    })
    render(<NetWorthSection />)

    // Fully vested: 10 × $5.00 = $50.00. The zero-quantity grant has no value and
    // is dropped; an unknown member falls back to "Unknown".
    expect(hooks.screenProps?.equity).toEqual([
      { label: 'Alex — Shares', valueCents: 50_00 },
      { label: 'Unknown — Options', valueCents: 50_00 },
    ])
  })

  it('maps each member with a positive HELP balance to a named liability', () => {
    mockLoaded()
    hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Alex' }] })
    hooks.useHelpDebts.mockReturnValue({
      loading: false,
      helpDebts: [
        { member_id: 'm1', balance_cents: 30_000_00 },
        { member_id: 'm2', balance_cents: 0 },
        { member_id: 'm3', balance_cents: 5_000_00 },
      ],
    })
    render(<NetWorthSection />)

    // The zero-balance debt is dropped; an unknown member falls back to "Unknown".
    expect(hooks.screenProps?.liabilities).toEqual([
      { label: "Alex's HELP debt", balanceCents: 30_000_00 },
      { label: "Unknown's HELP debt", balanceCents: 5_000_00 },
    ])
  })

  it('projects net worth forward, accruing super from each member contribution', () => {
    mockLoaded()
    hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Alex' }] })
    // A taxable salary gives the member a gross, so employer SG produces a net
    // annual super contribution that the projection accrues year on year.
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [
        {
          id: 'i1',
          household_id: 'h1',
          member_id: 'm1',
          name: 'Salary',
          taxable: true,
          attracts_super: true,
          type: 'salary',
          schedule: 'annual',
          interval_count: null,
          amount_cents: 100_000_00,
          hourly_rate_cents: null,
          hours_per_period: null,
          starts_on: null,
          ends_on: null,
          created_at: '',
          updated_at: '',
        },
      ],
    })
    render(<NetWorthSection />)

    const projection = hooks.screenProps?.projection as { year: number; superCents: number }[]
    expect(hooks.screenProps?.projectionBaseYear).toBe(new Date().getFullYear())
    // No super balance today, but contributions lift the balance by the horizon.
    expect(projection.at(0)?.superCents).toBe(0)
    expect(projection.at(-1)?.superCents).toBeGreaterThan(0)
  })

  it('folds a funded goal into cash without double-counting its linked saver balance', () => {
    mockLoaded()
    // A saver holding $8,000 is already in the account totals; a goal linked to it
    // targets $10,000 and is funded $100/fn, so cash starts at the saver balance
    // and climbs by future contributions capped at the $2,000 remaining.
    hooks.useAccounts.mockReturnValue({
      loading: false,
      update: vi.fn(),
      accounts: [
        {
          id: 'acc1',
          name: 'House deposit',
          balance_cents: 8_000_00,
          exclude_from_net_worth: false,
        },
      ],
    })
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [
        {
          id: 'g1',
          name: 'House',
          target_amount_cents: 10_000_00,
          current_balance_cents: 0,
          linked_account_id: 'acc1',
        },
      ],
    })
    hooks.useBudgetLines.mockReturnValue({
      loading: false,
      lines: [{ id: 'b1', goal_id: 'g1', amount_cents: 100_00, frequency: 'fortnightly' }],
    })
    render(<NetWorthSection />)

    const projection = hooks.screenProps?.projection as { year: number; otherCents: number }[]
    // Year 0 is the saver balance (no double count); the goal adds only the $2,000
    // remaining, reached by year 1 and then held flat.
    expect(projection.at(0)?.otherCents).toBe(8_000_00)
    expect(projection.at(1)?.otherCents).toBe(10_000_00)
    expect(projection.at(-1)?.otherCents).toBe(10_000_00)
  })

  it('splits a negative-balance account into its own debt band, respecting exclusion', () => {
    mockLoaded()
    hooks.useAccounts.mockReturnValue({
      loading: false,
      update: vi.fn(),
      accounts: [
        { id: 'a1', name: 'Everyday', balance_cents: 5_000_00, exclude_from_net_worth: false },
        { id: 'a2', name: 'Credit card', balance_cents: -1_200_00, exclude_from_net_worth: false },
        { id: 'a3', name: 'Old loan', balance_cents: -9_999_00, exclude_from_net_worth: true },
      ],
    })
    render(<NetWorthSection />)

    const projection = hooks.screenProps?.projection as {
      otherCents: number
      debtCents: number
      totalCents: number
    }[]
    // Cash counts only the positive balance; the credit card becomes its own debt
    // band, the excluded loan is left out entirely, and net worth nets the two.
    expect(projection.at(0)).toMatchObject({
      otherCents: 5_000_00,
      debtCents: 1_200_00,
      totalCents: 3_800_00,
    })
  })

  it('counts a home loan as a liability, in the debt band and off the total', () => {
    mockLoaded()
    hooks.useAccounts.mockReturnValue({
      loading: false,
      update: vi.fn(),
      accounts: [
        { id: 'a1', name: 'Everyday', balance_cents: 20_000_00, exclude_from_net_worth: false },
        // Up reports a home-loan balance as a negative number (the amount owing).
        {
          id: 'a2',
          name: 'Home loan',
          balance_cents: -400_000_00,
          exclude_from_net_worth: false,
          type: 'home_loan',
        },
        {
          id: 'a3',
          name: 'Old loan',
          balance_cents: -50_000_00,
          exclude_from_net_worth: true,
          type: 'home_loan',
        },
      ],
    })
    render(<NetWorthSection />)

    // The view gets the home loan as a positive amount owed; the excluded one drops.
    expect(hooks.screenProps?.liabilities).toEqual([])
    const projection = hooks.screenProps?.projection as {
      otherCents: number
      debtCents: number
      totalCents: number
    }[]
    expect(projection.at(0)).toMatchObject({
      otherCents: 20_000_00,
      debtCents: 400_000_00,
      totalCents: -380_000_00,
    })
  })

  it('redraws the projection to the chosen horizon', () => {
    mockLoaded()
    render(<NetWorthSection />)

    const initial = hooks.screenProps?.projection as unknown[]
    // Default "to retirement" with no ages set → the 30-year fallback → 31 points.
    expect(initial).toHaveLength(31)

    const change = hooks.screenProps?.onHorizonChange as (option: string) => void
    act(() => change('5y'))

    // Five years spans years 0–5 inclusive → 6 points.
    const updated = hooks.screenProps?.projection as unknown[]
    expect(updated).toHaveLength(6)
  })

  it('maps linked goal names per account and removes a deleted-in-Up account', async () => {
    mockLoaded()
    const remove = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn().mockResolvedValue(undefined)
    hooks.useAccounts.mockReturnValue({
      loading: false,
      update: vi.fn(),
      remove,
      accounts: [
        {
          id: 'acc1',
          name: 'House deposit',
          balance_cents: 8_000_00,
          exclude_from_net_worth: false,
          deleted_from_source_at: '2026-09-01T00:00:00Z',
        },
      ],
    })
    hooks.useGoals.mockReturnValue({
      loading: false,
      reload,
      goals: [
        { id: 'g1', name: 'House', target_amount_cents: 10_000_00, linked_account_id: 'acc1' },
        { id: 'g2', name: 'Rainy day', target_amount_cents: 5_000_00, linked_account_id: null },
      ],
    })
    render(<NetWorthSection />)

    const linked = hooks.screenProps?.linkedGoalNamesByAccount as Map<string, string[]>
    expect(linked.get('acc1')).toEqual(['House'])
    expect(linked.has('g2')).toBe(false)

    const onRemoveAccount = hooks.screenProps?.onRemoveAccount as (id: string) => Promise<void>
    await onRemoveAccount('acc1')
    expect(remove).toHaveBeenCalledWith('acc1')
    expect(reload).toHaveBeenCalled()
  })

  it('passes a baseline total and projected net worth while planning mode is active', () => {
    hooks.planningActive = true
    mockLoaded()
    hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Alex' }] })
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [{ ...salaryInflow(), amount_cents: 200_000_00 }],
      baselineInflows: [salaryInflow()],
    })
    hooks.useGoals.mockReturnValue({ loading: false, goals: [], baselineGoals: [] })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [], baselineLines: [] })
    render(<NetWorthSection />)
    hooks.planningActive = false

    expect(typeof hooks.screenProps?.baselineTotalCents).toBe('number')
    // The bigger salary accrues more super, so the proposed projection ends higher.
    const projection = hooks.screenProps?.projection as { totalCents: number }[]
    const proposedEnd = projection[projection.length - 1]?.totalCents ?? 0
    expect(hooks.screenProps?.baselineProjectionEndCents).toBeLessThan(proposedEnd)
  })

  it('toggling exclusion updates the account with the flag', () => {
    mockLoaded()
    const update = vi.fn().mockResolvedValue(undefined)
    hooks.useAccounts.mockReturnValue({ loading: false, accounts: [], update })
    render(<NetWorthSection />)

    const onToggleExclude = hooks.screenProps?.onToggleExclude as (
      id: string,
      exclude: boolean,
    ) => void
    onToggleExclude('a1', true)
    expect(update).toHaveBeenCalledWith('a1', { exclude_from_net_worth: true })
  })
})
