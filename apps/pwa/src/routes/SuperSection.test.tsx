import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { SuperSection } from './SuperSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useSuperProfiles: vi.fn(),
  useAccounts: vi.fn(),
  useSuperContributions: vi.fn(),
  useInflows: vi.fn(),
  onSave: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useSuperProfiles', () => ({ useSuperProfiles: hooks.useSuperProfiles }))
vi.mock('../hooks/useAccounts', () => ({ useAccounts: hooks.useAccounts }))
vi.mock('../hooks/useSuperContributions', () => ({
  useSuperContributions: hooks.useSuperContributions,
}))
vi.mock('../hooks/useInflows', () => ({ useInflows: hooks.useInflows }))
vi.mock('../hooks/useSaveSuperProfile', () => ({ useSaveSuperProfile: () => hooks.onSave }))
vi.mock('../components/SuperScreen', () => ({
  SuperScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="super-screen" />
  },
}))

describe('SuperSection', () => {
  it('shows the loading screen until data loads', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useSuperProfiles.mockReturnValue({ loading: false, profiles: [] })
    hooks.useAccounts.mockReturnValue({ loading: false, insert: vi.fn(), update: vi.fn() })
    hooks.useSuperContributions.mockReturnValue({ loading: false })
    hooks.useInflows.mockReturnValue({ loading: false })
    render(<SuperSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the super screen with computed summaries', () => {
    hooks.useMembers.mockReturnValue({ members: [{ id: 'm1', name: 'Alex' }], loading: false })
    hooks.useSuperProfiles.mockReturnValue({
      loading: false,
      profiles: [],
      financialYear: 2027,
      upsert: vi.fn(),
    })
    hooks.useAccounts.mockReturnValue({
      loading: false,
      accounts: [],
      insert: vi.fn(),
      update: vi.fn(),
    })
    hooks.useSuperContributions.mockReturnValue({
      loading: false,
      contributions: [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    })
    hooks.useInflows.mockReturnValue({ loading: false, inflows: [] })
    render(<SuperSection />)
    expect(screen.getByTestId('super-screen')).toBeInTheDocument()
    expect(hooks.screenProps?.onSave).toBe(hooks.onSave)
    expect(hooks.screenProps).toHaveProperty('capSummaries')
    expect(hooks.screenProps).toHaveProperty('netContributionByMember')
  })
})
