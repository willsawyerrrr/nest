import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { InflowsSection } from './InflowsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useInflows: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../components/InflowScreen', () => ({
  InflowScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="inflow-screen" />
  },
}))

describe('InflowsSection', () => {
  it('shows the loading screen until members and inflows load', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useInflows.mockReturnValue({ loading: false })
    render(<InflowsSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the inflow screen with members and inflows', () => {
    const members = [{ id: 'm1', name: 'Alex' }]
    const create = vi.fn()
    hooks.useMembers.mockReturnValue({ members, loading: false })
    hooks.useInflows.mockReturnValue({
      loading: false,
      inflows: [],
      create,
      update: vi.fn(),
      remove: vi.fn(),
    })
    render(<InflowsSection />)
    expect(screen.getByTestId('inflow-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ members })
    expect(hooks.screenProps?.onCreateInflow).toBe(create)
  })
})
