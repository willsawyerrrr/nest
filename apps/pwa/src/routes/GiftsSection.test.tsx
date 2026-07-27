import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { render, screen } from '../test/render'
import { GiftsSection } from './GiftsSection'

const hooks = vi.hoisted(() => ({
  useGifts: vi.fn(),
  useGiftTransactions: vi.fn(),
  useMembers: vi.fn(),
  useCurrentMember: vi.fn(),
  useUpSync: vi.fn(),
  refreshArg: null as (() => Promise<void>) | null,
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../hooks/useGiftTransactions', () => ({
  useGiftTransactions: hooks.useGiftTransactions,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useCurrentMember', () => ({ useCurrentMember: hooks.useCurrentMember }))
vi.mock('../hooks/useUpSync', () => ({
  useUpSync: (arg: () => Promise<void>) => {
    hooks.refreshArg = arg
    return hooks.useUpSync()
  },
}))
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
  reload: vi.fn().mockResolvedValue(undefined),
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

const loadedTransactions = {
  loading: false,
  transactions: [],
  dismissals: [],
  reload: vi.fn().mockResolvedValue(undefined),
  dismiss: vi.fn(),
  restore: vi.fn(),
}

/** Resolves every hook the section reads, so the screen renders. */
function mockLoaded(giftOverrides: Record<string, unknown> = {}) {
  hooks.useGifts.mockReturnValue({ ...loadedGifts, ...giftOverrides })
  hooks.useGiftTransactions.mockReturnValue(loadedTransactions)
  hooks.useMembers.mockReturnValue({ members: [will], loading: false })
  hooks.useCurrentMember.mockReturnValue({ member: will, loading: false })
  hooks.useUpSync.mockReturnValue({ refresh: vi.fn(), refreshing: false, error: null })
}

describe('GiftsSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the loading screen while gifts load', () => {
    mockLoaded()
    hooks.useGifts.mockReturnValue({ loading: true })
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the loading screen while the gift transactions load', () => {
    mockLoaded()
    hooks.useGiftTransactions.mockReturnValue({ ...loadedTransactions, loading: true })
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows the loading screen while members or the current member resolve', () => {
    mockLoaded()
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useCurrentMember.mockReturnValue({ member: null, loading: true })
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the gifts screen as a top-level tab with loaded data and the current member', () => {
    mockLoaded()
    render(<GiftsSection householdId="h1" />)
    expect(screen.getByTestId('gifts-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ members: [will], currentMemberId: 'm1' })
    expect(hooks.screenProps?.backTo).toBeUndefined()
    expect(hooks.screenProps?.backLabel).toBeUndefined()
  })

  it('wires the Up refresh through the gift and inbox reloads', async () => {
    const refresh = vi.fn()
    mockLoaded()
    hooks.useUpSync.mockReturnValue({ refresh, refreshing: false, error: null })
    render(<GiftsSection householdId="h1" />)

    // A sync brings in newly categorised transactions and trues a linked
    // purchase's amount up to its settled transaction, so both reload.
    await hooks.refreshArg?.()
    expect(loadedGifts.reload).toHaveBeenCalledOnce()
    expect(loadedTransactions.reload).toHaveBeenCalledOnce()

    const onRefresh = hooks.screenProps!.onRefresh as () => void
    onRefresh()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('creates a gift budget directly, with no breakdown to mint', async () => {
    // Gifts roll up standalone (keyed by budget_line.is_gift_line); the reconciler
    // derives the lines, so the screen just creates the gift budget.
    const createBudget = vi.fn().mockResolvedValue(undefined)
    mockLoaded({ createBudget })
    render(<GiftsSection householdId="h1" />)

    const onCreateBudget = hooks.screenProps?.onCreateBudget as (input: unknown) => Promise<void>
    const input = {
      recipient_id: 'r1',
      occasion_id: 'o1',
      budgeted_amount_cents: 5000,
      event_date: null,
    }
    await onCreateBudget(input)

    expect(createBudget).toHaveBeenCalledWith(input)
  })
})
