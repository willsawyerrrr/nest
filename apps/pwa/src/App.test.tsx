import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import type { Session } from '@supabase/supabase-js'
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
  rpc: vi.fn(),
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
    rpc: mocks.rpc,
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
vi.mock('./routes/GoalsSection', () => ({ GoalsSection: () => <div>GoalsSection</div> }))
vi.mock('./routes/TaxSection', () => ({ TaxSection: () => <div>TaxSection</div> }))
vi.mock('./routes/SuperSection', () => ({ SuperSection: () => <div>SuperSection</div> }))
vi.mock('./routes/BreakdownsSection', () => ({
  BreakdownsSection: () => <div>BreakdownsSection</div>,
}))
vi.mock('./routes/BreakdownDetailSection', () => ({
  BreakdownDetailSection: () => <div>BreakdownDetailSection</div>,
}))
vi.mock('./routes/ChangelogSection', () => ({
  ChangelogSection: () => <div>ChangelogSection</div>,
}))
vi.mock('./routes/HomeSection', () => ({ HomeSection: () => <div>HomeSection</div> }))

const session = { user: { id: 'u1' } } as unknown as Session
const household = { id: 'h1', name: 'Home' } as Household

function householdResult(overrides: Partial<UseHouseholdResult> = {}): UseHouseholdResult {
  return {
    households: [household],
    loading: false,
    reload: vi.fn().mockResolvedValue(undefined),
    createInviteCode: vi.fn().mockResolvedValue(undefined),
    revokeInviteCode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderApp(initialEntries: string[] = ['/summary']) {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MantineProvider theme={theme} env="test">
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
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

  it('shows onboarding and runs create/join on success and error', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    mocks.useHousehold.mockReturnValue(householdResult({ households: [] }))
    renderApp()

    const create = await screen.findByRole('button', { name: 'create' })
    const join = screen.getByRole('button', { name: 'join' })

    mocks.rpc.mockResolvedValueOnce({ error: null })
    await userEvent.click(create)
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_household', {
      p_name: 'Home',
      p_member_name: 'Will',
    })

    mocks.rpc.mockResolvedValueOnce({ error: new Error('nope') })
    await userEvent.click(create)

    mocks.rpc.mockResolvedValueOnce({ error: null })
    await userEvent.click(join)
    expect(mocks.rpc).toHaveBeenLastCalledWith('join_household', {
      p_code: 'CODE',
      p_member_name: 'Will',
    })

    mocks.rpc.mockResolvedValueOnce({ error: new Error('nope') })
    await userEvent.click(join)
  })

  it('renders the routed shell with a household', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    renderApp()
    expect(await screen.findByText('SummarySection')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Summary' }).length).toBeGreaterThan(0)
  })

  it('routes to the household section', async () => {
    mocks.getSession.mockResolvedValue({ data: { session } })
    renderApp(['/household'])
    expect(await screen.findByText('HomeSection')).toBeInTheDocument()
  })
})
