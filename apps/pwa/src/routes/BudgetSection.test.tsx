import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { BudgetSection } from './BudgetSection'

const hooks = vi.hoisted(() => ({
  useBudgetLines: vi.fn(),
  useTemporaryItems: vi.fn(),
  useGoals: vi.fn(),
  useGifts: vi.fn(),
  useBreakdowns: vi.fn(),
  useAccountDirectory: vi.fn(),
  useSuperProfiles: vi.fn(),
  usePlanningMode: vi.fn(() => ({ active: false })),
  derivedEditor: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useBudgetLines', () => ({ useBudgetLines: hooks.useBudgetLines }))
vi.mock('../hooks/useTemporaryItems', () => ({ useTemporaryItems: hooks.useTemporaryItems }))
vi.mock('../hooks/useGoals', () => ({ useGoals: hooks.useGoals }))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../hooks/useBreakdowns', () => ({ useBreakdowns: hooks.useBreakdowns }))
vi.mock('../hooks/useAccountDirectory', () => ({
  useAccountDirectory: hooks.useAccountDirectory,
}))
vi.mock('../hooks/useSuperProfiles', () => ({ useSuperProfiles: hooks.useSuperProfiles }))
vi.mock('../hooks/useDerivedLineEditor', () => ({
  useDerivedLineEditor: () => hooks.derivedEditor,
}))
vi.mock('../components/PlanningModeProvider', () => ({ usePlanningMode: hooks.usePlanningMode }))
vi.mock('../components/BudgetScreen', () => ({
  BudgetScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="budget-screen" />
  },
}))

afterEach(() => hooks.usePlanningMode.mockReturnValue({ active: false }))

function loadedHooks() {
  hooks.useBudgetLines.mockReturnValue({
    loading: false,
    lines: [],
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  })
  hooks.useTemporaryItems.mockReturnValue({
    loading: false,
    items: [],
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  })
  hooks.useGoals.mockReturnValue({ loading: false, goals: [] })
  hooks.useGifts.mockReturnValue({ loading: false, budgets: [] })
  hooks.useBreakdowns.mockReturnValue({
    loading: false,
    breakdowns: [],
    items: [],
    update: vi.fn(),
  })
  hooks.useAccountDirectory.mockReturnValue({ loading: false, accounts: [] })
  hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
}

describe('BudgetSection', () => {
  it('shows the loading screen until every source loads', () => {
    hooks.useBudgetLines.mockReturnValue({ loading: true })
    hooks.useTemporaryItems.mockReturnValue({ loading: false })
    hooks.useGoals.mockReturnValue({ loading: false })
    hooks.useGifts.mockReturnValue({ loading: false })
    hooks.useBreakdowns.mockReturnValue({ loading: false })
    hooks.useAccountDirectory.mockReturnValue({ loading: false })
    hooks.useSuperProfiles.mockReturnValue({ loading: false })
    render(<BudgetSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the budget screen and maps goals, accounts, and breakdowns', () => {
    hooks.useBudgetLines.mockReturnValue({
      loading: false,
      lines: [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    })
    hooks.useTemporaryItems.mockReturnValue({
      loading: false,
      items: [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    })
    hooks.useGoals.mockReturnValue({
      loading: false,
      goals: [{ id: 'g1', name: 'House', linked_account_id: 'a2' }],
    })
    hooks.useGifts.mockReturnValue({ loading: false, budgets: [] })
    hooks.useBreakdowns.mockReturnValue({
      loading: false,
      breakdowns: [{ id: 'b1', name: 'Meds', line_group: 'needs' }],
      items: [],
      update: vi.fn(),
    })
    hooks.useAccountDirectory.mockReturnValue({
      loading: false,
      accounts: [{ id: 'a1', name: 'Spending' }],
    })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    render(<BudgetSection householdId="h1" />)
    expect(screen.getByTestId('budget-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.goals).toEqual([{ id: 'g1', name: 'House', linkedAccountId: 'a2' }])
    expect(hooks.screenProps?.accounts).toEqual([{ id: 'a1', name: 'Spending' }])
    expect(hooks.screenProps?.breakdowns).toEqual([{ id: 'b1', name: 'Meds', line_group: 'needs' }])
    expect(hooks.screenProps?.onUpdateDerivedLine).toBe(hooks.derivedEditor)
  })

  it('withholds the derived-line editor in planning mode so derived lines are read-only', () => {
    hooks.usePlanningMode.mockReturnValue({ active: true })
    loadedHooks()
    render(<BudgetSection householdId="h1" />)
    expect(hooks.screenProps?.onUpdateDerivedLine).toBeUndefined()
  })
})
