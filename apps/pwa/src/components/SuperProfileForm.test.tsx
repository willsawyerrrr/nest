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

  it('shows the effective balance and accrual breakdown for a dated baseline', () => {
    render(
      <SuperProfileForm
        member={member}
        initialBalanceCents={10_000_00}
        balanceAsOf="2025-07-20"
        netAnnualContributionCents={12_000_00}
        today={new Date('2026-07-20T00:00:00Z')}
        onSubmit={vi.fn()}
      />,
    )

    // Baseline $10,000 + a full year of $12,000 contributions = $22,000 today.
    expect(screen.getByText('Estimated balance today')).toBeInTheDocument()
    expect(screen.getByText('$22,000.00')).toBeInTheDocument()
    expect(
      screen.getByText(/\$10,000\.00 confirmed on .* \$12,000\.00 accrued/),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/actual balance today/i)).toHaveValue('$22,000.00')
    expect(screen.getByRole('button', { name: /update actual balance/i })).toBeInTheDocument()
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<SuperProfileForm member={member} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
