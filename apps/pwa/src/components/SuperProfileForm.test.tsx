import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../test/render'
import { SuperProfileForm } from './SuperProfileForm'
import type { Member } from '../hooks/useMembers'

const member: Member = {
  id: 'm1',
  household_id: 'h1',
  name: 'Will',
  email: null,
  user_id: 'u1',
  up_connected_at: null,
  created_at: '',
  updated_at: '',
}

describe('SuperProfileForm', () => {
  it('submits fund name and balance converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SuperProfileForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/fund name/i), 'AustralianSuper')
    await user.type(screen.getByLabelText(/current balance/i), '125000')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        fundName: 'AustralianSuper',
        balanceCents: 12500000,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('prefills fund name and balance from existing values', () => {
    render(
      <SuperProfileForm
        member={member}
        initialFundName="Hostplus"
        initialBalanceCents={5000000}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/fund name/i)).toHaveValue('Hostplus')
    expect(screen.getByLabelText(/current balance/i)).toHaveValue('$50,000.00')
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<SuperProfileForm member={member} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
