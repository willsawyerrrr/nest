import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { InvestmentsSection } from './InvestmentsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useTrades: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useTrades', () => ({ useTrades: hooks.useTrades }))
vi.mock('../components/TradesScreen', () => ({
  TradesScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="trades-screen" />
  },
}))

describe('InvestmentsSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useTrades.mockReturnValue({ loading: false })
    render(<InvestmentsSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the trades screen with members and trades', () => {
    const create = vi.fn()
    const update = vi.fn()
    const remove = vi.fn()
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useTrades.mockReturnValue({ loading: false, trades: [], create, update, remove })
    render(<InvestmentsSection />)
    expect(screen.getByTestId('trades-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Alex' }])
    expect(hooks.screenProps?.trades).toEqual([])
    expect(hooks.screenProps?.onCreate).toBe(create)
    expect(hooks.screenProps?.onUpdate).toBe(update)
    expect(hooks.screenProps?.onDelete).toBe(remove)
  })
})
