import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { BreakdownsSection } from './BreakdownsSection'

const hooks = vi.hoisted(() => ({
  useBreakdowns: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useBreakdowns', () => ({ useBreakdowns: hooks.useBreakdowns }))
vi.mock('../components/BreakdownsScreen', () => ({
  BreakdownsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="breakdowns-screen" />
  },
}))

describe('BreakdownsSection', () => {
  it('shows the loading screen while data loads', () => {
    hooks.useBreakdowns.mockReturnValue({ loading: true })
    render(<BreakdownsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the breakdowns screen with loaded data', () => {
    const create = vi.fn()
    hooks.useBreakdowns.mockReturnValue({
      loading: false,
      breakdowns: [{ id: 'b1', name: 'Meds', kind: 'generic', line_group: 'needs' }],
      items: [],
      create,
    })
    render(<BreakdownsSection householdId="h1" />)
    expect(screen.getByTestId('breakdowns-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.onCreate).toBe(create)
    expect(hooks.screenProps?.breakdowns).toEqual([
      { id: 'b1', name: 'Meds', kind: 'generic', line_group: 'needs' },
    ])
  })
})
