import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeMember, makeWishlistItem } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { WishlistForm } from './WishlistForm'

const members = [makeMember({ id: 'm1', name: 'Will' }), makeMember({ id: 'm2', name: 'Sam' })]

describe('WishlistForm', () => {
  it('submits a new item with dollars converted to cents, a member tag, and a note', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<WishlistForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'New couch')
    await user.type(screen.getByLabelText(/rough cost/i), '3500')
    await user.click(screen.getByRole('combobox', { name: /whose wish/i }))
    await user.click(await screen.findByRole('option', { name: 'Sam' }))
    await user.type(screen.getByLabelText(/note/i), '  The sectional one  ')
    await user.click(screen.getByRole('button', { name: /add wishlist item/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'New couch',
        amount_cents: 3_500_00,
        member_id: 'm2',
        note: 'The sectional one',
      }),
    )
  })

  it('submits a null member and null note when neither is given', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<WishlistForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Weekend away')
    await user.type(screen.getByLabelText(/rough cost/i), '800')
    await user.click(screen.getByRole('button', { name: /add wishlist item/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Weekend away',
        amount_cents: 800_00,
        member_id: null,
        note: null,
      }),
    )
  })

  it('omits the member picker when the household has no members loaded', () => {
    render(<WishlistForm members={[]} onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText(/whose wish/i)).not.toBeInTheDocument()
  })

  it('prefills every field when editing and saves the edit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <WishlistForm
        initial={makeWishlistItem({
          name: 'Espresso machine',
          amount_cents: 1_200_00,
          member_id: 'm1',
          note: 'Dual boiler',
        })}
        members={members}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByLabelText(/name/i)).toHaveValue('Espresso machine')
    expect(screen.getByLabelText(/rough cost/i)).toHaveValue('$1,200.00')
    expect(screen.getByLabelText(/note/i)).toHaveValue('Dual boiler')

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Espresso machine', member_id: 'm1', note: 'Dual boiler' }),
      ),
    )
  })

  it('disables submit until a name and a positive amount are entered', async () => {
    const user = userEvent.setup()
    render(<WishlistForm members={members} onSubmit={vi.fn()} />)

    const submit = screen.getByRole('button', { name: /add wishlist item/i })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Something')
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(/rough cost/i), '50')
    expect(submit).toBeEnabled()
  })

  it('calls onCancel from the Cancel button', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<WishlistForm members={members} onSubmit={vi.fn()} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
