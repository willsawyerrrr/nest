import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMember, makeWishlistItem } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { WishlistScreen } from './WishlistScreen'

const members = [makeMember({ id: 'm1', name: 'Will' }), makeMember({ id: 'm2', name: 'Sam' })]

function renderScreen(overrides: Partial<Parameters<typeof WishlistScreen>[0]> = {}) {
  const props: Parameters<typeof WishlistScreen>[0] = {
    items: [makeWishlistItem()],
    members,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn(),
    onPromoteToGoal: vi.fn(),
    onPromoteToBudget: vi.fn(),
    ...overrides,
  }
  render(<WishlistScreen {...props} />)
  return props
}

beforeEach(() => window.localStorage.clear())

describe('WishlistScreen', () => {
  it('shows the empty state and no sort control when there are no items', () => {
    renderScreen({ items: [] })
    expect(screen.getByText(/nothing on your wishlist yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /sort by/i })).not.toBeInTheDocument()
  })

  it('renders an item with its amount, owner chip, and note', () => {
    renderScreen({
      items: [
        makeWishlistItem({
          name: 'Espresso machine',
          amount_cents: 1_200_00,
          member_id: 'm1',
          note: 'Dual boiler',
        }),
      ],
    })
    expect(screen.getByText('Espresso machine')).toBeInTheDocument()
    expect(screen.getByText('$1,200.00')).toBeInTheDocument()
    expect(screen.getByText('Will')).toBeInTheDocument()
    expect(screen.getByText('Dual boiler')).toBeInTheDocument()
  })

  it('omits the owner chip and note when the item carries neither', () => {
    renderScreen({ items: [makeWishlistItem({ name: 'New couch', member_id: null, note: null })] })
    expect(screen.getByText('New couch')).toBeInTheDocument()
    expect(screen.queryByText('Will')).not.toBeInTheDocument()
  })

  it('sorts by title then by amount, ascending and descending', async () => {
    const user = userEvent.setup()
    renderScreen({
      items: [
        makeWishlistItem({ id: 'w1', name: 'Bravo', amount_cents: 100_00 }),
        makeWishlistItem({ id: 'w2', name: 'Alpha', amount_cents: 300_00 }),
      ],
    })

    const names = () => screen.getAllByText(/Alpha|Bravo/).map((node) => node.textContent)
    expect(names()).toEqual(['Alpha', 'Bravo'])

    await user.click(screen.getByRole('combobox', { name: /sort by/i }))
    await user.click(await screen.findByRole('option', { name: 'Amount' }))
    expect(names()).toEqual(['Bravo', 'Alpha'])

    await user.click(screen.getByRole('button', { name: /toggle sort direction/i }))
    expect(names()).toEqual(['Alpha', 'Bravo'])
  })

  it('creates a wishlist item through the add form', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderScreen({ items: [] })

    await user.click(screen.getByRole('button', { name: /add wishlist item/i }))
    await user.type(screen.getByLabelText(/name/i), 'Weekend away')
    await user.type(screen.getByLabelText(/rough cost/i), '800')
    await user.click(screen.getByRole('button', { name: /add wishlist item/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Weekend away', amount_cents: 800_00 }),
      ),
    )
  })

  it('edits a wishlist item through its inline form', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderScreen({ items: [makeWishlistItem({ id: 'w1', name: 'Couch' })] })

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const name = screen.getByLabelText(/name/i)
    await user.clear(name)
    await user.type(name, 'Sofa')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('w1', expect.objectContaining({ name: 'Sofa' })),
    )
  })

  it('deletes a wishlist item after confirmation', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderScreen({ items: [makeWishlistItem({ id: 'w1', name: 'Couch' })] })

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    expect(onDelete).toHaveBeenCalledWith('w1')
  })

  it('promotes an item to a goal and to the budget', async () => {
    const user = userEvent.setup()
    const item = makeWishlistItem({ id: 'w1', name: 'Couch' })
    const { onPromoteToGoal, onPromoteToBudget } = renderScreen({ items: [item] })

    await user.click(screen.getByRole('button', { name: /make a savings goal/i }))
    expect(onPromoteToGoal).toHaveBeenCalledWith(item)

    await user.click(screen.getByRole('button', { name: /add to budget/i }))
    expect(onPromoteToBudget).toHaveBeenCalledWith(item)
  })
})
