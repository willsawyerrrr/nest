import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { NetWorthSection } from './NetWorthSection'

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
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
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
    render(<NetWorthSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the net-worth view with effective balances', () => {
    mockLoaded()
    render(<NetWorthSection householdId="h1" />)
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
    render(<NetWorthSection householdId="h1" />)

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
    render(<NetWorthSection householdId="h1" />)

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
    render(<NetWorthSection householdId="h1" />)

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
    render(<NetWorthSection householdId="h1" />)

    const projection = hooks.screenProps?.projection as { year: number; otherCents: number }[]
    // Year 0 is the saver balance (no double count); the goal adds only the $2,000
    // remaining, reached by year 1 and then held flat.
    expect(projection.at(0)?.otherCents).toBe(8_000_00)
    expect(projection.at(1)?.otherCents).toBe(10_000_00)
    expect(projection.at(-1)?.otherCents).toBe(10_000_00)
  })

  it('toggling exclusion updates the account with the flag', () => {
    mockLoaded()
    const update = vi.fn().mockResolvedValue(undefined)
    hooks.useAccounts.mockReturnValue({ loading: false, accounts: [], update })
    render(<NetWorthSection householdId="h1" />)

    const onToggleExclude = hooks.screenProps?.onToggleExclude as (
      id: string,
      exclude: boolean,
    ) => void
    onToggleExclude('a1', true)
    expect(update).toHaveBeenCalledWith('a1', { exclude_from_net_worth: true })
  })
})
