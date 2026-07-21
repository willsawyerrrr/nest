import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { NetWorthSection } from './NetWorthSection'

const hooks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  useSuperProfiles: vi.fn(),
  useSuperContributions: vi.fn(),
  useInflows: vi.fn(),
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
vi.mock('../components/NetWorthView', () => ({
  NetWorthView: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="net-worth-view" />
  },
}))

describe('NetWorthSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useAccounts.mockReturnValue({ loading: true })
    hooks.useSuperProfiles.mockReturnValue({ loading: false })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useInflows.mockReturnValue({ loading: false })
    render(<NetWorthSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the net-worth view with effective balances', () => {
    hooks.useAccounts.mockReturnValue({ loading: false, accounts: [] })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    render(<NetWorthSection householdId="h1" />)
    expect(screen.getByTestId('net-worth-view')).toBeInTheDocument()
    expect(hooks.screenProps).toHaveProperty('accounts')
    expect(hooks.screenProps).toHaveProperty('superIds')
  })

  it('toggling exclusion updates the account with the flag', () => {
    const update = vi.fn().mockResolvedValue(undefined)
    hooks.useAccounts.mockReturnValue({ loading: false, accounts: [], update })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    render(<NetWorthSection householdId="h1" />)

    const onToggleExclude = hooks.screenProps?.onToggleExclude as (
      id: string,
      exclude: boolean,
    ) => void
    onToggleExclude('a1', true)
    expect(update).toHaveBeenCalledWith('a1', { exclude_from_net_worth: true })
  })
})
