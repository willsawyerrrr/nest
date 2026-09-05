import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { MembersSection } from './MembersSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useTaxProfiles: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useTaxProfiles', () => ({ useTaxProfiles: hooks.useTaxProfiles }))
vi.mock('../components/MembersScreen', () => ({
  MembersScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="members-screen" />
  },
}))

describe('MembersSection', () => {
  beforeEach(() => {
    hooks.screenProps = null
  })

  it('shows the loading screen until members and tax profiles load', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true, setDateOfBirth: vi.fn() })
    hooks.useTaxProfiles.mockReturnValue({ loading: false })

    render(<MembersSection householdId="h1" />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the members screen once loaded', () => {
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex' }],
      loading: false,
      setDateOfBirth: vi.fn(),
    })
    hooks.useTaxProfiles.mockReturnValue({
      loading: false,
      profiles: [{ member_id: 'm1' }],
      financialYear: 2027,
      upsert: vi.fn(),
    })

    render(<MembersSection householdId="h1" />)

    expect(screen.getByTestId('members-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ financialYear: 2027 })
  })

  it('saves a tax profile and the member’s date of birth together', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined)
    const setDateOfBirth = vi.fn().mockResolvedValue(undefined)
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex' }],
      loading: false,
      setDateOfBirth,
    })
    hooks.useTaxProfiles.mockReturnValue({
      loading: false,
      profiles: [],
      financialYear: 2027,
      upsert,
    })

    render(<MembersSection householdId="h1" />)

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
