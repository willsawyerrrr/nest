import { describe, expect, it, vi } from 'vitest'
import { makeAccount, makeMember } from '../test/fixtures'
import { render, screen } from '../test/render'
import { AccountsSection } from './AccountsSection'

const hooks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  useMembers: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useAccounts', () => ({ useAccounts: hooks.useAccounts }))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../components/AccountsScreen', () => ({
  AccountsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="accounts-screen" />
  },
}))

describe('AccountsSection', () => {
  it('shows the loading screen until accounts and members load', () => {
    hooks.useAccounts.mockReturnValue({ accounts: null, loading: true })
    hooks.useMembers.mockReturnValue({ members: [], loading: false })
    render(<AccountsSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the accounts screen with accounts and members', () => {
    const accounts = [makeAccount()]
    const members = [makeMember()]
    hooks.useAccounts.mockReturnValue({ accounts, loading: false })
    hooks.useMembers.mockReturnValue({ members, loading: false })
    render(<AccountsSection />)
    expect(screen.getByTestId('accounts-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toEqual({ accounts, members })
  })
})
