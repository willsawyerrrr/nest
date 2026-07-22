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
      { label: 'Alex HELP debt', balanceCents: 30_000_00 },
      { label: 'Unknown HELP debt', balanceCents: 5_000_00 },
    ])
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
