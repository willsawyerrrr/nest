import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBudgetDraft, takeBudgetDraft } from '../lib/promoteDraft'
import { act, render, screen } from '../test/render'
import { BudgetSection } from './BudgetSection'

const hooks = vi.hoisted(() => ({
  useBudgetLines: vi.fn(),
  useTemporaryItems: vi.fn(),
  useGoals: vi.fn(),
  useGifts: vi.fn(),
  useBreakdowns: vi.fn(),
  useAccountDirectory: vi.fn(),
  useSuperProfiles: vi.fn(),
  useMembers: vi.fn(() => ({ loading: false, members: [] as unknown[] })),
  useMemberAllowances: vi.fn((): Record<string, unknown> => ({ loading: false, allowances: [] })),
  useCurrentMember: vi.fn(() => ({
    loading: false,
    member: { id: 'm1' } as { id: string } | null,
  })),
  usePlanningMode: vi.fn(() => ({ active: false })),
  useInflows: vi.fn(() => ({
    loading: false,
    baselineInflows: [
      { type: 'salary', paid_on: null, pay_anchor_date: '2026-11-12' },
    ] as unknown[],
  })),
  useActualSpend: vi.fn(),
  categoryGroups: { categories: [], setGroup: vi.fn(), resetGroup: vi.fn() },
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
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useCurrentMember', () => ({ useCurrentMember: hooks.useCurrentMember }))
vi.mock('../hooks/useMemberAllowances', () => ({
  useMemberAllowances: hooks.useMemberAllowances,
}))
vi.mock('../hooks/useDerivedLineEditor', () => ({
  useDerivedLineEditor: () => hooks.derivedEditor,
}))
vi.mock('../hooks/useNow', () => ({ useNow: () => new Date(2026, 10, 20) }))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useActualSpend', () => ({ useActualSpend: hooks.useActualSpend }))
vi.mock('../hooks/useCategoryGroups', () => ({ useCategoryGroups: () => hooks.categoryGroups }))
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
    render(<BudgetSection />)
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
    render(<BudgetSection />)
    expect(screen.getByTestId('budget-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.goals).toEqual([{ id: 'g1', name: 'House', linkedAccountId: 'a2' }])
    expect(hooks.screenProps?.accounts).toEqual([{ id: 'a1', name: 'Spending' }])
    expect(hooks.screenProps?.breakdowns).toEqual([{ id: 'b1', name: 'Meds', line_group: 'needs' }])
    expect(hooks.screenProps?.onUpdateDerivedLine).toBe(hooks.derivedEditor)
  })

  it('hands a promoted wishlist draft to the screen and clears it once consumed', () => {
    setBudgetDraft({ name: 'New couch', amountCents: 3_500_00 })
    loadedHooks()
    render(<BudgetSection />)

    expect(hooks.screenProps?.promoteDraft).toEqual({ name: 'New couch', amountCents: 3_500_00 })
    expect(takeBudgetDraft()).toBeNull()

    act(() => (hooks.screenProps!.onPromoteConsumed as () => void)())
    expect(hooks.screenProps?.promoteDraft).toBeNull()
  })

  it('withholds the derived-line editor in planning mode so derived lines are read-only', () => {
    hooks.usePlanningMode.mockReturnValue({ active: true })
    loadedHooks()
    render(<BudgetSection />)
    expect(hooks.screenProps?.onUpdateDerivedLine).toBeUndefined()
  })

  it('hands the screen the members and their allowances with the allowance edit', () => {
    loadedHooks()
    const update = vi.fn()
    hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Ada' }] })
    hooks.useMemberAllowances.mockReturnValue({
      loading: false,
      allowances: [{ id: 'al1', member_id: 'm1' }],
      update,
    })
    render(<BudgetSection />)

    expect(hooks.screenProps?.members).toEqual([{ id: 'm1', name: 'Ada' }])
    expect(hooks.screenProps?.allowances).toEqual([{ id: 'al1', member_id: 'm1' }])
    expect(hooks.screenProps?.currentMemberId).toBe('m1')
    expect(hooks.screenProps?.onUpdateAllowance).toBe(update)
  })

  it('reconciles the pay-cycle fortnight holding today and steps through earlier ones', async () => {
    const user = userEvent.setup()
    loadedHooks()
    const groups = { needs: 1_00, wants: 0, discretionary: 0, savings: 0, investments: 0 }
    hooks.useActualSpend.mockReturnValue({ groups, unbudgeted: 5_00 })
    render(<BudgetSection />)

    expect(hooks.useActualSpend).toHaveBeenLastCalledWith(
      { periodStart: '2026-11-12', periodEnd: '2026-11-25' },
      false,
    )
    expect(hooks.screenProps?.actualByGroup).toBe(groups)

    render(hooks.screenProps!.actualSpendBar as ReactElement)
    await user.click(screen.getByRole('button', { name: 'Previous fortnight' }))
    expect(hooks.useActualSpend).toHaveBeenLastCalledWith(
      { periodStart: '2026-10-29', periodEnd: '2026-11-11' },
      false,
    )
  })

  it('counts pending spend once asked', async () => {
    const user = userEvent.setup()
    loadedHooks()
    hooks.useActualSpend.mockReturnValue(null)
    render(<BudgetSection />)

    const { unmount } = render(hooks.screenProps!.actualSpendBar as ReactElement)
    await user.click(screen.getByRole('switch', { name: 'Include pending' }))
    expect(hooks.useActualSpend).toHaveBeenLastCalledWith(
      { periodStart: '2026-11-12', periodEnd: '2026-11-25' },
      true,
    )
    unmount()
    expect(hooks.screenProps?.actualByGroup).toBeUndefined()
  })

  it('opens the category groups map', async () => {
    const user = userEvent.setup()
    loadedHooks()
    hooks.useActualSpend.mockReturnValue(null)
    render(<BudgetSection />)

    expect(screen.queryByRole('dialog', { name: 'Category groups' })).not.toBeInTheDocument()
    render(hooks.screenProps!.actualSpendBar as ReactElement)
    await user.click(screen.getByRole('button', { name: 'Category groups' }))
    expect(await screen.findByRole('dialog', { name: 'Category groups' })).toBeInTheDocument()
  })
})
