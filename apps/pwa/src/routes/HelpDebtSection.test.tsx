import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { HelpDebtSection } from './HelpDebtSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useHelpDebts: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../components/HelpDebtScreen', () => ({
  HelpDebtScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="help-debt-screen" />
  },
}))

describe('HelpDebtSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useHelpDebts.mockReturnValue({ loading: false })
    render(<HelpDebtSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the help-debt screen with members and debts', () => {
    const upsert = vi.fn()
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [], upsert })
    render(<HelpDebtSection />)
    expect(screen.getByTestId('help-debt-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Alex' }])
    expect(hooks.screenProps?.onSave).toBe(upsert)
  })
})
