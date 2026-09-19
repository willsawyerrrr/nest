import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import type { Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Household, UseHouseholdResult } from './hooks/useHousehold'
import { theme } from './theme'

// Auth-change listener callback and subscription, captured so tests can drive
// session changes and assert the effect's cleanup.
type AuthCallback = (event: string, session: Session | null) => void

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(),
  useHousehold: vi.fn(),
  unsubscribe: vi.fn(),
  authCallback: { current: null as AuthCallback | null },
}))

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: (cb: AuthCallback) => {
        mocks.authCallback.current = cb
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
      },
      signInWithOAuth: mocks.signInWithOAuth,
    },
  },
}))

vi.mock('./hooks/useHousehold', () => ({ useHousehold: mocks.useHousehold }))

// Onboarding is mocked so its create/join callbacks can be invoked directly,
// exercising both the success (reload) and error (throw) paths in AuthedApp.
vi.mock('./components/OnboardingScreen', () => ({
  OnboardingScreen: ({
    onCreate,
    onJoin,
  }: {
    onCreate: (name: string, memberName: string) => Promise<void>
    onJoin: (code: string, memberName: string) => Promise<void>
  }) => (
    <div>
      <button onClick={() => void onCreate('Home', 'Will').catch(() => {})}>create</button>
      <button onClick={() => void onJoin('CODE', 'Will').catch(() => {})}>join</button>
    </div>
  ),
}))

// The routed sections are mocked so the shell renders without their data hooks.
vi.mock('./routes/SummarySection', () => ({ SummarySection: () => <div>SummarySection</div> }))
vi.mock('./routes/NetWorthSection', () => ({ NetWorthSection: () => <div>NetWorthSection</div> }))
vi.mock('./routes/InflowsSection', () => ({ InflowsSection: () => <div>InflowsSection</div> }))
vi.mock('./routes/BudgetSection', () => ({ BudgetSection: () => <div>BudgetSection</div> }))
vi.mock('./routes/SplitsSection', () => ({ SplitsSection: () => <div>SplitsSection</div> }))
vi.mock('./routes/PayslipsSection', () => ({
  PayslipsSection: () => <div>PayslipsSection</div>,
}))
vi.mock('./routes/GoalsSection', () => ({ GoalsSection: () => <div>GoalsSection</div> }))
vi.mock('./routes/WishlistSection', () => ({ WishlistSection: () => <div>WishlistSection</div> }))
vi.mock('./routes/TaxSection', () => ({ TaxSection: () => <div>TaxSection</div> }))
vi.mock('./routes/DeductionsSection', () => ({
  DeductionsSection: () => <div>DeductionsSection</div>,
}))
vi.mock('./routes/SuperSection', () => ({ SuperSection: () => <div>SuperSection</div> }))
vi.mock('./routes/HelpDebtSection', () => ({ HelpDebtSection: () => <div>HelpDebtSection</div> }))
vi.mock('./routes/EofySection', () => ({ EofySection: () => <div>EofySection</div> }))
vi.mock('./routes/EquitySection', () => ({ EquitySection: () => <div>EquitySection</div> }))
vi.mock('./routes/GiftsSection', () => ({ GiftsSection: () => <div>GiftsSection</div> }))
vi.mock('./routes/BreakdownsSection', () => ({
  BreakdownsSection: () => <div>BreakdownsSection</div>,
}))
vi.mock('./routes/BreakdownDetailSection', () => ({
  BreakdownDetailSection: () => <div>BreakdownDetailSection</div>,
}))
vi.mock('./routes/ChangelogSection', () => ({
  ChangelogSection: () => <div>ChangelogSection</div>,
}))
vi.mock('./routes/HouseholdSection', () => ({
  HouseholdSection: () => <div>HouseholdSection</div>,
}))
vi.mock('./routes/MembersSection', () => ({ MembersSection: () => <div>MembersSection</div> }))
vi.mock('./routes/ConnectionsSection', () => ({
  ConnectionsSection: () => <div>ConnectionsSection</div>,
}))
vi.mock('./routes/NotificationsSection', () => ({
  NotificationsSection: () => <div>NotificationsSection</div>,
}))
vi.mock('./routes/PlanningModeSection', () => ({
  PlanningModeSection: () => <div>PlanningModeSection</div>,
}))
vi.mock('./routes/PlanningSection', () => ({ PlanningSection: () => <div>PlanningSection</div> }))
vi.mock('./routes/EofyShareSection', () => ({
  EofyShareSection: () => <div>EofyShareSection</div>,
}))

const session = { user: { id: 'u1' } } as unknown as Session
const household = { id: 'h1', name: 'Home' } as Household

function householdResult(overrides: Partial<UseHouseholdResult> = {}): UseHouseholdResult {
  return {
    households: [household],
    loading: false,
    reload: vi.fn().mockResolvedValue(undefined),
    createHousehold: vi.fn().mockResolvedValue(undefined),
    joinHousehold: vi.fn().mockResolvedValue(undefined),
    createInviteCode: vi.fn().mockResolvedValue(undefined),
    revokeInviteCode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderApp(initialEntries: string[] = ['/summary']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MantineProvider theme={theme} env="test">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>
    )
  }
  return rtlRender(<App />, { wrapper: Providers })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authCallback.current = null
  mocks.getSession.mockResolvedValue({ data: { session: null } })
  mocks.useHousehold.mockReturnValue(householdResult())
})

afterEach(() => vi.clearAllMocks())

describe('App', () => {
  it('shows the loader while the session is resolving', () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}))
    renderApp()
    expect(document.querySelector('.mantine-Loader-root')).not.toBeNull()
  })

  it('shows the sign-in screen when unauthenticated and wires the Google button', async () => {
    renderApp()
    const button = await screen.findByRole('button', { name: /continue with google/i })
    await userEvent.click(button)
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  })

  it('reacts to an auth-state change and unsubscribes on unmount', async () => {
    const { unmount } = renderApp()
    await screen.findByRole('button', { name: /continue with google/i })
    act(() => mocks.authCallback.current?.('SIGNED_IN', session))
    expect(await screen.findByText('SummarySection')).toBeInTheDocument()
    unmount()
    expect(mocks.unsubscribe).toHaveBeenCalled()
  })

  it('shows the loader while the household is loading', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    mocks.useHousehold.mockReturnValue(householdResult({ households: null, loading: true }))
    renderApp()
    await waitFor(() => expect(document.querySelector('.mantine-Loader-root')).not.toBeNull())
  })

  it('shows onboarding and delegates create/join to the household hook', async () => {
    const createHousehold = vi.fn().mockResolvedValue(undefined)
    const joinHousehold = vi.fn().mockResolvedValue(undefined)
    mocks.getSession.mockResolvedValue({ data: { session } })
    mocks.useHousehold.mockReturnValue(
      householdResult({ households: [], createHousehold, joinHousehold }),
    )
    renderApp()

    const create = await screen.findByRole('button', { name: 'create' })
    const join = screen.getByRole('button', { name: 'join' })

    await userEvent.click(create)
    expect(createHousehold).toHaveBeenCalledWith('Home', 'Will')

    await userEvent.click(join)
    expect(joinHousehold).toHaveBeenCalledWith('CODE', 'Will')
  })

  it('renders the routed shell with a household', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    renderApp()
    expect(await screen.findByText('SummarySection')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Summary' }).length).toBeGreaterThan(0)
  })

  // Each path lazily loads its section chunk, so awaiting the mocked section's
  // text also exercises every route's dynamic-import factory.
  it.each([
    ['/net-worth', 'NetWorthSection'],
    ['/inflows', 'InflowsSection'],
    ['/budget', 'BudgetSection'],
    ['/splits', 'SplitsSection'],
    ['/goals', 'GoalsSection'],
    ['/wishlist', 'WishlistSection'],
    ['/tax', 'TaxSection'],
    ['/payslips', 'PayslipsSection'],
    ['/deductions', 'DeductionsSection'],
    ['/super', 'SuperSection'],
    ['/help-debt', 'HelpDebtSection'],
    ['/eofy', 'EofySection'],
    ['/equity', 'EquitySection'],
    ['/gifts', 'GiftsSection'],
    ['/breakdowns', 'BreakdownsSection'],
    ['/breakdowns/b1', 'BreakdownDetailSection'],
    ['/whats-new', 'ChangelogSection'],
    ['/settings/account', 'HouseholdSection'],
    ['/settings/members', 'MembersSection'],
    ['/settings/connections', 'ConnectionsSection'],
    ['/settings/notifications', 'NotificationsSection'],
    ['/settings/planning-mode', 'PlanningModeSection'],
    ['/planning', 'PlanningSection'],
  ])('routes to %s', async (path, section) => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    renderApp([path])
    expect(await screen.findByText(section)).toBeInTheDocument()
  })

  it('redirects the old /household route to the Household settings page', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    renderApp(['/household'])
    expect(await screen.findByText('HouseholdSection')).toBeInTheDocument()
  })

  it('redirects the old /settings/partner route to the Household settings page', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    renderApp(['/settings/partner'])
    expect(await screen.findByText('HouseholdSection')).toBeInTheDocument()
  })

  it('shows the Planning nav entry only while planning mode is active', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    renderApp()
    await screen.findByText('SummarySection')
    expect(screen.queryByRole('link', { name: 'Planning' })).not.toBeInTheDocument()

    localStorage.setItem('planning-mode:h1', JSON.stringify({ active: true, overrides: {} }))
    renderApp()
    expect((await screen.findAllByRole('link', { name: 'Planning' })).length).toBeGreaterThan(0)
    localStorage.clear()
  })

  it('waits on the injected session in the native shell instead of showing sign-in', async () => {
    window.__NEST_NATIVE_SHELL__ = true
    try {
      renderApp()
      await waitFor(() => expect(document.querySelector('.mantine-Loader-root')).not.toBeNull())
      expect(
        screen.queryByRole('button', { name: /continue with google/i }),
      ).not.toBeInTheDocument()

      mocks.getSession.mockResolvedValue({ data: { session } })
      act(() => mocks.authCallback.current?.('SIGNED_IN', session))
      expect(await screen.findByText('SummarySection')).toBeInTheDocument()
    } finally {
      delete window.__NEST_NATIVE_SHELL__
    }
  })

  it('renders the public share route without ever checking the session', async () => {
    mocks.getSession.mockReturnValue(new Promise(() => {})) // never resolves
    renderApp(['/share/eofy/a-token'])
    expect(await screen.findByText('EofyShareSection')).toBeInTheDocument()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('matches the share route ahead of the session gate even when signed out', async () => {
    renderApp(['/share/eofy/a-token'])
    expect(await screen.findByText('EofyShareSection')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })
})
