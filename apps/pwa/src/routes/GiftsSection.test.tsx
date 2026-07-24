import { describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { render, screen } from '../test/render'
import { GiftsSection } from './GiftsSection'

const hooks = vi.hoisted(() => ({
  useGifts: vi.fn(),
  useBreakdowns: vi.fn(),
  useMembers: vi.fn(),
  useCurrentMember: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../hooks/useBreakdowns', () => ({ useBreakdowns: hooks.useBreakdowns }))
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

function loadedBreakdowns(overrides: Record<string, unknown> = {}) {
  return { loading: false, breakdowns: [], create: vi.fn(), ...overrides }
}

describe('GiftsSection', () => {
  it('shows the loading screen while gifts load', () => {
    hooks.useGifts.mockReturnValue({ loading: true })
    hooks.useBreakdowns.mockReturnValue(loadedBreakdowns())
    hooks.useMembers.mockReturnValue({ members: [will], loading: false })
    hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the loading screen while breakdowns load', () => {
    hooks.useGifts.mockReturnValue(loadedGifts)
    hooks.useBreakdowns.mockReturnValue(loadedBreakdowns({ loading: true }))
    hooks.useMembers.mockReturnValue({ members: [will], loading: false })
    hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the loading screen while members or the current member resolve', () => {
    hooks.useGifts.mockReturnValue(loadedGifts)
    hooks.useBreakdowns.mockReturnValue(loadedBreakdowns())
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useCurrentMember.mockReturnValue({ member: null, loading: true })
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the gifts screen as a top-level tab with loaded data and the current member', () => {
    hooks.useGifts.mockReturnValue(loadedGifts)
    hooks.useBreakdowns.mockReturnValue(loadedBreakdowns())
    hooks.useMembers.mockReturnValue({ members: [will], loading: false })
    hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('gifts-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ members: [will], currentMemberId: 'm1' })
    expect(hooks.screenProps?.backTo).toBeUndefined()
    expect(hooks.screenProps?.backLabel).toBeUndefined()
  })

  it('mints the gift breakdown on the first gift budget when the household has none', async () => {
    const createBudget = vi.fn().mockResolvedValue(undefined)
    const createBreakdown = vi.fn().mockResolvedValue(undefined)
    hooks.useGifts.mockReturnValue({ ...loadedGifts, createBudget })
    hooks.useBreakdowns.mockReturnValue(loadedBreakdowns({ create: createBreakdown }))
    hooks.useMembers.mockReturnValue({ members: [will], loading: false })
    hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
    render(<GiftsSection householdId="h1" />)

    const onCreateBudget = hooks.screenProps?.onCreateBudget as (input: unknown) => Promise<void>
    const input = {
      recipient_id: 'r1',
      occasion_id: 'o1',
      budgeted_amount_cents: 5000,
      event_date: null,
    }
    await onCreateBudget(input)

    expect(createBreakdown).toHaveBeenCalledWith({
      name: 'Gifts',
      line_group: 'wants',
      kind: 'gift',
    })
    expect(createBudget).toHaveBeenCalledWith(input)
  })

  it('reuses the existing gift breakdown rather than minting another', async () => {
    const createBudget = vi.fn().mockResolvedValue(undefined)
    const createBreakdown = vi.fn().mockResolvedValue(undefined)
    hooks.useGifts.mockReturnValue({ ...loadedGifts, createBudget })
    hooks.useBreakdowns.mockReturnValue(
      loadedBreakdowns({
        breakdowns: [{ id: 'b1', kind: 'gift', name: 'Gifts', line_group: 'wants' }],
        create: createBreakdown,
      }),
    )
    hooks.useMembers.mockReturnValue({ members: [will], loading: false })
    hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
    render(<GiftsSection householdId="h1" />)

    const onCreateBudget = hooks.screenProps?.onCreateBudget as (input: unknown) => Promise<void>
    const input = {
      recipient_id: 'r1',
      occasion_id: 'o1',
      budgeted_amount_cents: 5000,
      event_date: null,
    }
    await onCreateBudget(input)

    expect(createBreakdown).not.toHaveBeenCalled()
    expect(createBudget).toHaveBeenCalledWith(input)
  })
})
