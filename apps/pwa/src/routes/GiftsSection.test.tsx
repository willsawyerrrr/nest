import { describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { render, screen } from '../test/render'
import { GiftsSection } from './GiftsSection'

const hooks = vi.hoisted(() => ({
  useGifts: vi.fn(),
  useMembers: vi.fn(),
  useCurrentMember: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useCurrentMember', () => ({ useCurrentMember: hooks.useCurrentMember }))
vi.mock('../components/GiftsScreen', () => ({
  GiftsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="gifts-screen" />
  },
}))

const will = makeMember({ id: 'm1', name: 'Will' })

const loadedGifts = {
  loading: false,
  recipients: [],
  occasions: [],
  budgets: [],
  purchases: [],
  createRecipient: vi.fn(),
  updateRecipient: vi.fn(),
  removeRecipient: vi.fn(),
  createOccasion: vi.fn(),
  updateOccasion: vi.fn(),
  removeOccasion: vi.fn(),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  removeBudget: vi.fn(),
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
  removePurchase: vi.fn(),
}

describe('GiftsSection', () => {
  it('shows the loading screen while gifts load', () => {
    hooks.useGifts.mockReturnValue({ loading: true })
    hooks.useMembers.mockReturnValue({ members: [will], loading: false })
    hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
    render(<GiftsSection householdId="h1" backTo="/breakdowns" backLabel="Breakdowns" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the loading screen while members or the current member resolve', () => {
    hooks.useGifts.mockReturnValue(loadedGifts)
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useCurrentMember.mockReturnValue({ member: null, loading: true })
    render(<GiftsSection householdId="h1" backTo="/breakdowns" backLabel="Breakdowns" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the gifts screen with loaded data, members, and the current member', () => {
    hooks.useGifts.mockReturnValue(loadedGifts)
    hooks.useMembers.mockReturnValue({ members: [will], loading: false })
    hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
    render(<GiftsSection householdId="h1" backTo="/budget" backLabel="Budget" />)
    expect(screen.getByTestId('gifts-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({
      backTo: '/budget',
      backLabel: 'Budget',
      members: [will],
      currentMemberId: 'm1',
    })
  })
})
