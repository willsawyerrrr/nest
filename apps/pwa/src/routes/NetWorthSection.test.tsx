import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { NetWorthSection } from './NetWorthSection'

const hooks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  useSuperProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useInflows: vi.fn(),
  useHelpDebts: vi.fn(),
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
  hooks.useMembers.mockReturnValue({ loading: false, members: [] })
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
