import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { SummarySection } from './SummarySection'

const hooks = vi.hoisted(() => ({
  useInflows: vi.fn(),
  useTaxProfiles: vi.fn(),
  useBudgetLines: vi.fn(),
  useTemporaryItems: vi.fn(),
  useSuperContributions: vi.fn(),
  useGifts: vi.fn(),
  useBreakdowns: vi.fn(),
  useHelpDebts: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useBudgetLines', () => ({ useBudgetLines: hooks.useBudgetLines }))
vi.mock('../hooks/useTemporaryItems', () => ({ useTemporaryItems: hooks.useTemporaryItems }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../hooks/useBreakdowns', () => ({ useBreakdowns: hooks.useBreakdowns }))
vi.mock('../hooks/useHelpDebts', () => ({ useHelpDebts: hooks.useHelpDebts }))
vi.mock('../components/SummaryView', () => ({
  SummaryView: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="summary-view" />
  },
}))

describe('SummarySection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useInflows.mockReturnValue({ loading: true })
    hooks.useTaxProfiles.mockReturnValue({ loading: false })
    hooks.useBudgetLines.mockReturnValue({ loading: false })
    hooks.useTemporaryItems.mockReturnValue({ loading: false })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useGifts.mockReturnValue({ loading: false })
    hooks.useBreakdowns.mockReturnValue({ loading: false })
    hooks.useHelpDebts.mockReturnValue({ loading: false })
    render(<SummarySection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the summary view from the computed plan', () => {
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    hooks.useTaxProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [] })
    hooks.useTemporaryItems.mockReturnValue({ loading: false, items: [] })
    hooks.useSuperContributions.mockReturnValue({ loading: false, contributions: [] })
    hooks.useGifts.mockReturnValue({ loading: false, budgets: [] })
    hooks.useBreakdowns.mockReturnValue({ loading: false, breakdowns: [], items: [] })
    hooks.useHelpDebts.mockReturnValue({ loading: false, helpDebts: [] })
    render(<SummarySection householdId="h1" />)
    expect(screen.getByTestId('summary-view')).toBeInTheDocument()
    expect(hooks.screenProps).toHaveProperty('summary')
  })
})
