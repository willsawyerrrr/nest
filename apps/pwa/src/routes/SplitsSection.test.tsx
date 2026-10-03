import { describe, expect, it, vi } from 'vitest'
import { makeMemberAllowance } from '../test/fixtures'
import { render, screen } from '../test/render'
import { SplitsSection } from './SplitsSection'

const hooks = vi.hoisted(() => ({
  useBudgetLines: vi.fn(),
  useGoals: vi.fn(),
  useAccountDirectory: vi.fn(),
  useSuperProfiles: vi.fn(),
  usePaySplits: vi.fn(),
  usePayAccount: vi.fn(),
  useMembers: vi.fn(() => ({ loading: false, members: [] as unknown[] })),
  useMemberAllowances: vi.fn(() => ({ loading: false, allowances: [] as unknown[] })),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useBudgetLines', () => ({ useBudgetLines: hooks.useBudgetLines }))
vi.mock('../hooks/useGoals', () => ({ useGoals: hooks.useGoals }))
vi.mock('../hooks/useAccountDirectory', () => ({
  useAccountDirectory: hooks.useAccountDirectory,
}))
vi.mock('../hooks/useSuperProfiles', () => ({ useSuperProfiles: hooks.useSuperProfiles }))
vi.mock('../hooks/usePaySplits', () => ({ usePaySplits: hooks.usePaySplits }))
vi.mock('../hooks/usePayAccount', () => ({ usePayAccount: hooks.usePayAccount }))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useMemberAllowances', () => ({
  useMemberAllowances: hooks.useMemberAllowances,
}))
vi.mock('../components/SplitsScreen', () => ({
  SplitsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="splits-screen" />
  },
}))

describe('SplitsSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useBudgetLines.mockReturnValue({ loading: true })
    hooks.useGoals.mockReturnValue({ loading: false })
    hooks.useAccountDirectory.mockReturnValue({ loading: false })
    hooks.useSuperProfiles.mockReturnValue({ loading: false })
    hooks.usePaySplits.mockReturnValue({ loading: false })
    hooks.usePayAccount.mockReturnValue({ loading: false })
    render(<SplitsSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the splits screen and forwards confirmations and clears', () => {
    const confirm = vi.fn()
    const clear = vi.fn()
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [] })
    hooks.useGoals.mockReturnValue({ loading: false, goals: [] })
    hooks.useAccountDirectory.mockReturnValue({
      loading: false,
      accounts: [{ id: 'a1', name: 'Spending' }],
    })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.usePaySplits.mockReturnValue({ loading: false, configuredByAccount: {}, confirm, clear })
    const setPayAccount = vi.fn()
    hooks.usePayAccount.mockReturnValue({ loading: false, payAccountId: null, setPayAccount })
    render(<SplitsSection />)
    expect(screen.getByTestId('splits-screen')).toBeInTheDocument()

    const onConfirm = hooks.screenProps?.onConfirm as (id: string, cents: number) => void
    onConfirm('a1', 1000)
    expect(confirm).toHaveBeenCalledWith('a1', 1000)
    expect(hooks.screenProps?.accounts).toEqual([{ id: 'a1', name: 'Spending' }])
    expect(hooks.screenProps?.payAccountId).toBeNull()

    const onSetPayAccount = hooks.screenProps?.onSetPayAccount as (id: string | null) => void
    onSetPayAccount('a1')
    expect(setPayAccount).toHaveBeenCalledWith('a1')

    const onClear = hooks.screenProps?.onClear as (id: string) => void
    onClear('a1')
    expect(clear).toHaveBeenCalledWith('a1')
  })

  it('hands the screen each member’s allowance, named and routed', () => {
    hooks.useBudgetLines.mockReturnValue({ loading: false, lines: [] })
    hooks.useGoals.mockReturnValue({ loading: false, goals: [] })
    hooks.useAccountDirectory.mockReturnValue({ loading: false, accounts: [] })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.usePaySplits.mockReturnValue({ loading: false, configuredByAccount: {} })
    hooks.usePayAccount.mockReturnValue({ loading: false, payAccountId: null })
    hooks.useMembers.mockReturnValue({ loading: false, members: [{ id: 'm1', name: 'Ada' }] })
    hooks.useMemberAllowances.mockReturnValue({
      loading: false,
      allowances: [makeMemberAllowance({ destination_account_id: 'a1' })],
    })
    render(<SplitsSection />)

    expect(hooks.screenProps?.allowances).toEqual([
      {
        memberId: 'm1',
        amountCents: 200_00,
        frequency: 'fortnightly',
        name: 'Ada’s allowance',
        destinationAccountId: 'a1',
      },
    ])
  })
})
