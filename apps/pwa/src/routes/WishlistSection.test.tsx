import { describe, expect, it, vi } from 'vitest'
import { takeBudgetDraft, takeGoalDraft } from '../lib/promoteDraft'
import { makeWishlistItem } from '../test/fixtures'
import { render, screen } from '../test/render'
import { WishlistSection } from './WishlistSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useWishlist: vi.fn(),
  navigate: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => hooks.navigate }))
vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useWishlist', () => ({ useWishlist: hooks.useWishlist }))
vi.mock('../components/WishlistScreen', () => ({
  WishlistScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="wishlist-screen" />
  },
}))

describe('WishlistSection', () => {
  it('shows the loading screen until members and the wishlist load', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useWishlist.mockReturnValue({ loading: false })
    render(<WishlistSection />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the wishlist screen with items and members', () => {
    const members = [{ id: 'm1', name: 'Will' }]
    const create = vi.fn()
    hooks.useMembers.mockReturnValue({ members, loading: false })
    hooks.useWishlist.mockReturnValue({
      loading: false,
      items: [makeWishlistItem()],
      create,
      update: vi.fn(),
      remove: vi.fn(),
    })
    render(<WishlistSection />)
    expect(screen.getByTestId('wishlist-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ members, items: [makeWishlistItem()] })
    expect(hooks.screenProps?.onCreate).toBe(create)
  })

  it('stashes a goal draft and navigates to the Goals tab when promoting to a goal', () => {
    hooks.useMembers.mockReturnValue({ members: [], loading: false })
    hooks.useWishlist.mockReturnValue({
      loading: false,
      items: [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    })
    render(<WishlistSection />)

    const item = makeWishlistItem({ name: 'Espresso machine', amount_cents: 1_200_00 })
    ;(hooks.screenProps!.onPromoteToGoal as (i: typeof item) => void)(item)

    expect(takeGoalDraft()).toEqual({ name: 'Espresso machine', amountCents: 1_200_00 })
    expect(hooks.navigate).toHaveBeenCalledWith('/goals')
  })

  it('stashes a budget draft and navigates to the Budget tab when promoting to the budget', () => {
    hooks.useMembers.mockReturnValue({ members: [], loading: false })
    hooks.useWishlist.mockReturnValue({
      loading: false,
      items: [],
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    })
    render(<WishlistSection />)

    const item = makeWishlistItem({ name: 'New couch', amount_cents: 3_500_00 })
    ;(hooks.screenProps!.onPromoteToBudget as (i: typeof item) => void)(item)

    expect(takeBudgetDraft()).toEqual({ name: 'New couch', amountCents: 3_500_00 })
    expect(hooks.navigate).toHaveBeenCalledWith('/budget')
  })
})
