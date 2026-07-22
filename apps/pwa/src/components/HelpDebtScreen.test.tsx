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
  balance_cents: 1000000,
  created_at: '',
  updated_at: '',
}

function card(name: string): HTMLElement {
  return screen.getByText(name).closest('.mantine-Card-root') as HTMLElement
}

describe('HelpDebtScreen', () => {
  it('prefills each member from their HELP balance and saves as cents', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<HelpDebtScreen members={members} helpDebts={[samDebt]} onSave={onSave} />)

    expect(within(card('Sam')).getByLabelText(/help debt/i)).toHaveValue('$10,000.00')

    const will = card('Will')
    await user.type(within(will).getByLabelText(/help debt/i), '25000')
    await user.click(within(will).getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ member_id: 'm1', balance_cents: 2500000 }),
    )
    expect(await within(will).findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('boom'))
    render(<HelpDebtScreen members={members} helpDebts={[]} onSave={onSave} />)

    const will = card('Will')
    await user.click(within(will).getByRole('button', { name: /save/i }))

    expect(await within(will).findByRole('alert')).toBeInTheDocument()
  })
})
