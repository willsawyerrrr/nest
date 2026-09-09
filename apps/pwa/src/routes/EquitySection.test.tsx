import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { EquitySection } from './EquitySection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useEquityGrants: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useEquityGrants', () => ({ useEquityGrants: hooks.useEquityGrants }))
vi.mock('../components/EquityScreen', () => ({
  EquityScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="equity-screen" />
  },
}))

describe('EquitySection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useEquityGrants.mockReturnValue({ loading: false })
    render(<EquitySection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the equity screen with members and grants', () => {
    const create = vi.fn()
    const update = vi.fn()
    const remove = vi.fn()
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useEquityGrants.mockReturnValue({ loading: false, grants: [], create, update, remove })
    render(<EquitySection />)
    expect(screen.getByTestId('equity-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Alex' }])
    expect(hooks.screenProps?.onCreate).toBe(create)
    expect(hooks.screenProps?.onUpdate).toBe(update)
    expect(hooks.screenProps?.onDelete).toBe(remove)
  })
})
