import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Household } from '../hooks/useHousehold'
import { render, screen } from '../test/render'
import { HomeSection } from './HomeSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useTaxProfiles: vi.fn(),
  useUpConnection: vi.fn(),
  signOut: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../hooks/useUpConnection', () => ({ useUpConnection: hooks.useUpConnection }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: hooks.signOut } } }))
vi.mock('../components/HomeScreen', () => ({
  HomeScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="home-screen" />
  },
}))

const household = {
  id: 'h1',
  name: 'Nest',
  invite_code: null,
  invite_code_expires_at: null,
} as unknown as Household

const session = { user: { id: 'u1', email: 'a@example.com' } } as unknown as Session

describe('HomeSection', () => {
  it('shows the loading screen until members and tax profiles load', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true, reload: vi.fn() })
    hooks.useTaxProfiles.mockReturnValue({ loading: false })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })
    render(
      <HomeSection
        household={household}
        session={session}
        onCreateInviteCode={vi.fn()}
        onRevokeInviteCode={vi.fn()}
      />,
    )
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the home screen and signs out through supabase', () => {
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'u1', name: 'Alex' }],
      loading: false,
      reload: vi.fn(),
    })
    hooks.useTaxProfiles.mockReturnValue({
      loading: false,
      profiles: [],
      financialYear: 2027,
      upsert: vi.fn(),
    })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })
    render(
      <HomeSection
        household={household}
        session={session}
        onCreateInviteCode={vi.fn()}
        onRevokeInviteCode={vi.fn()}
      />,
    )
    expect(screen.getByTestId('home-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ email: 'a@example.com', currentUserId: 'u1' })
    const onSignOut = hooks.screenProps!.onSignOut as () => void
    onSignOut()
    expect(hooks.signOut).toHaveBeenCalledOnce()
  })

  it('defaults the email to an empty string when absent', () => {
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'u1', name: 'Alex' }],
      loading: false,
      reload: vi.fn(),
    })
    hooks.useTaxProfiles.mockReturnValue({
      loading: false,
      profiles: [],
      financialYear: 2027,
      upsert: vi.fn(),
    })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })
    render(
      <HomeSection
        household={household}
        session={{ user: { id: 'u1' } } as unknown as Session}
        onCreateInviteCode={vi.fn()}
        onRevokeInviteCode={vi.fn()}
      />,
    )
    expect(hooks.screenProps?.email).toBe('')
  })

  it('saves a tax profile and the member’s date of birth together', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined)
    const setDateOfBirth = vi.fn().mockResolvedValue(undefined)
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex' }],
      loading: false,
      reload: vi.fn(),
      setDateOfBirth,
    })
    hooks.useTaxProfiles.mockReturnValue({
      loading: false,
      profiles: [],
      financialYear: 2027,
      upsert,
    })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })
    render(
      <HomeSection
        household={household}
        session={session}
        onCreateInviteCode={vi.fn()}
        onRevokeInviteCode={vi.fn()}
      />,
    )

    const profile = { member_id: 'm1', residency: 'resident', has_private_hospital_cover: false }
    const onUpsert = hooks.screenProps!.onUpsertTaxProfile as (submission: {
      profile: typeof profile
      dateOfBirth: string | null
    }) => Promise<void>
    await onUpsert({ profile, dateOfBirth: '1990-01-01' })

    expect(upsert).toHaveBeenCalledWith(profile)
    expect(setDateOfBirth).toHaveBeenCalledWith('m1', '1990-01-01')
  })
})
