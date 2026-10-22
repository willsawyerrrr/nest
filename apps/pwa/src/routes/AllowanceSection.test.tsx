import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { makeMemberAllowance } from '../test/fixtures'
import { render, screen } from '../test/render'
import { AllowanceSection } from './AllowanceSection'

const hooks = vi.hoisted(() => ({
  useBudgetLines: vi.fn(),
  useGoals: vi.fn(),
  useAccountDirectory: vi.fn(),
  useSuperProfiles: vi.fn(),
  useMemberAllowances: vi.fn(),
  useCurrentMember: vi.fn(),
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
vi.mock('../hooks/useMemberAllowances', () => ({
  useMemberAllowances: hooks.useMemberAllowances,
}))
vi.mock('../hooks/useCurrentMember', () => ({ useCurrentMember: hooks.useCurrentMember }))
vi.mock('../components/AllowanceScreen', () => ({
  AllowanceScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="allowance-screen" />
  },
}))

function setup({
  loading = false,
  member = { id: 'm1', name: 'Ada' } as { id: string; name: string } | null,
  loaded = true,
} = {}) {
  hooks.useBudgetLines.mockReturnValue({
    loading,
    lines: loaded ? [] : undefined,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  })
  hooks.useGoals.mockReturnValue({
    loading: false,
    goals: loaded ? [{ id: 'g1', name: 'Trip', linked_account_id: 'a1' }] : undefined,
  })
  hooks.useAccountDirectory.mockReturnValue({
    loading: false,
    accounts: loaded
      ? [
          { id: 'a1', name: 'Spending' },
          { id: 'a2', name: 'Super' },
        ]
      : undefined,
  })
  hooks.useSuperProfiles.mockReturnValue({
    loading: false,
    profiles: loaded ? [{ linked_account_id: 'a2' }] : undefined,
  })
  hooks.useMemberAllowances.mockReturnValue({
    loading: false,
    allowances: loaded ? [makeMemberAllowance()] : undefined,
  })
  hooks.useCurrentMember.mockReturnValue({ loading: false, member })
  render(
    <MemoryRouter initialEntries={['/allowance']}>
      <Routes>
        <Route path="/allowance" element={<AllowanceSection />} />
        <Route path="/budget" element={<div data-testid="budget" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AllowanceSection', () => {
  it('shows the loading screen until data loads', () => {
    setup({ loading: true })
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('sends a member with no allowance back to the budget', () => {
    setup({ member: null })
    expect(screen.getByTestId('budget')).toBeInTheDocument()
    expect(hooks.useMemberAllowances).toHaveBeenCalled()
  })

  it('sends a member to the budget while their allowance has not loaded', () => {
    setup({ loaded: false })
    expect(screen.getByTestId('budget')).toBeInTheDocument()
  })

  it('renders the member’s allowance with spendable accounts only', () => {
    setup()
    expect(screen.getByTestId('allowance-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({
      memberName: 'Ada',
      goals: [{ id: 'g1', name: 'Trip', linkedAccountId: 'a1' }],
      accounts: [{ id: 'a1', name: 'Spending' }],
    })
  })
})
