import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { HelpDebt } from '../hooks/useHelpDebts'
import { makeMember } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { HelpDebtScreen } from './HelpDebtScreen'

const members = [
  makeMember({ id: 'm1', name: 'Will', user_id: 'u1' }),
  makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' }),
]

const samDebt: HelpDebt = {
  id: 'hd2',
  household_id: 'h1',
  member_id: 'm2',
  balance_cents: 10_000_00,
  created_at: '',
  updated_at: '',
}

function card(name: string): HTMLElement {
  return screen.getByText(name).closest('.mantine-Card-root') as HTMLElement
}

describe('HelpDebtScreen', () => {
  it('shows each member’s balance, defaulting to $0.00 without a debt', () => {
    render(<HelpDebtScreen members={members} helpDebts={[samDebt]} onSave={vi.fn()} />)

    expect(within(card('Sam')).getByText('$10,000.00')).toBeInTheDocument()
    expect(within(card('Will')).getByText('$0.00')).toBeInTheDocument()
    // The input is hidden until the user clicks Edit.
    expect(screen.queryByLabelText(/help debt/i)).not.toBeInTheDocument()
  })

  it('reveals the edit form prefilled and saves as cents', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<HelpDebtScreen members={members} helpDebts={[samDebt]} onSave={onSave} />)

    await user.click(within(card('Sam')).getByRole('button', { name: /edit/i }))
    expect(within(card('Sam')).getByLabelText(/help debt/i)).toHaveValue('$10,000.00')

    const will = card('Will')
    await user.click(within(will).getByRole('button', { name: /edit/i }))
    await user.type(within(card('Will')).getByLabelText(/help debt/i), '25000')
    await user.click(within(card('Will')).getByRole('button', { name: /^save$/i }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ member_id: 'm1', balance_cents: 25_000_00 }),
    )
    // Saving returns Will to the read row.
    await waitFor(() =>
      expect(within(card('Will')).getByRole('button', { name: /edit/i })).toBeInTheDocument(),
    )
  })

  it('closes the form on cancel without saving', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<HelpDebtScreen members={members} helpDebts={[samDebt]} onSave={onSave} />)

    await user.click(within(card('Will')).getByRole('button', { name: /edit/i }))
    await user.click(within(card('Will')).getByRole('button', { name: /cancel/i }))

    expect(within(card('Will')).getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('boom'))
    render(<HelpDebtScreen members={members} helpDebts={[]} onSave={onSave} />)

    await user.click(within(card('Will')).getByRole('button', { name: /edit/i }))
    await user.click(within(card('Will')).getByRole('button', { name: /^save$/i }))

    expect(await within(card('Will')).findByRole('alert')).toBeInTheDocument()
  })
})
