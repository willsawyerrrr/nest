import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { GoalsSection } from './GoalsSection'

const hooks = vi.hoisted(() => ({
  useGoals: vi.fn(),
  useBudgetLines: vi.fn(),
  useSavers: vi.fn(),
  useUpSync: vi.fn(),
  refreshArg: null as (() => Promise<void>) | null,
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useGoals', () => ({ useGoals: hooks.useGoals }))
vi.mock('../hooks/useBudgetLines', () => ({ useBudgetLines: hooks.useBudgetLines }))
vi.mock('../hooks/useSavers', () => ({ useSavers: hooks.useSavers }))
vi.mock('../hooks/useUpSync', () => ({
  useUpSync: (arg: () => Promise<void>) => {
    hooks.refreshArg = arg
    return hooks.useUpSync()
  },
}))
vi.mock('../components/GoalScreen', () => ({
  GoalScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="goal-screen" />
  },
}))

describe('GoalsSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useGoals.mockReturnValue({ loading: true, reload: vi.fn() })
    hooks.useBudgetLines.mockReturnValue({ loading: false })
    hooks.useSavers.mockReturnValue({ loading: false, reload: vi.fn() })
    hooks.useUpSync.mockReturnValue({ refresh: vi.fn(), refreshing: false, error: null })
    render(<GoalsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the goal screen and wires refresh through the reloads', async () => {
    const reloadSavers = vi.fn().mockResolvedValue(undefined)
    const reloadGoals = vi.fn().mockResolvedValue(undefined)
    const reloadLines = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn()
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [],
      reload: reloadGoals,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    })
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [], reload: reloadLines })
    hooks.useSavers.mockReturnValue({ loading: false, savers: [], reload: reloadSavers })
    hooks.useUpSync.mockReturnValue({ refresh, refreshing: false, error: null })
    render(<GoalsSection householdId="h1" />)
    expect(screen.getByTestId('goal-screen')).toBeInTheDocument()

    // The refresh callback reloads the savers, the goals, and the budget lines
    // whose gift-funding the Up sync re-derives via the trigger.
    await hooks.refreshArg?.()
    expect(reloadSavers).toHaveBeenCalledOnce()
    expect(reloadGoals).toHaveBeenCalledOnce()
    expect(reloadLines).toHaveBeenCalledOnce()

    // The screen's onRefresh triggers the saver refresh.
    const onRefresh = hooks.screenProps!.onRefresh as () => void
    onRefresh()
    expect(refresh).toHaveBeenCalledOnce()
  })
})
