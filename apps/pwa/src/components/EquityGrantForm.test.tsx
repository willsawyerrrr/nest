import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EquityGrantRow } from '../hooks/useEquityGrants'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { EquityGrantForm } from './EquityGrantForm'

const member = { id: 'm1', name: 'Will' }

function makeGrant(overrides: Partial<EquityGrantRow> = {}): EquityGrantRow {
  return {
    id: 'eg1',
    household_id: 'h1',
    member_id: 'm1',
    label: '2023 shares',
    instrument_type: 'share',
    quantity: 100,
    grant_date: '2023-06-01',
    cliff_months: 12,
    vesting_period_months: 48,
    vesting_frequency: 'monthly',
    strike_price_cents: null,
    price_per_share_cents: 2_00,
    price_as_of: '2026-01-01',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('EquityGrantForm', () => {
  it('submits an option grant with the strike and price in cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<EquityGrantForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/^label$/i), '2024 options')
    await user.type(screen.getByLabelText(/^quantity$/i), '5000')
    await user.type(screen.getByLabelText(/strike price/i), '1')
    await user.type(screen.getByLabelText(/price per share/i), '3')
    await user.click(screen.getByRole('combobox', { name: /vesting frequency/i }))
    await user.click(await screen.findByRole('option', { name: 'Quarterly' }))
    await user.click(screen.getByRole('button', { name: /^add grant$/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          member_id: 'm1',
          label: '2024 options',
          instrument_type: 'option',
          quantity: 5000,
          strike_price_cents: 100,
          price_per_share_cents: 300,
          cliff_months: 12,
          vesting_period_months: 48,
          vesting_frequency: 'quarterly',
        }),
      ),
    )
  })

  it('hides the strike and stores a null strike for a share grant', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<EquityGrantForm member={member} onSubmit={onSubmit} />)

    await user.click(screen.getByText('Shares'))
    expect(screen.queryByLabelText(/strike price/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/^label$/i), '2024 shares')
    await user.type(screen.getByLabelText(/^quantity$/i), '10')
    await user.type(screen.getByLabelText(/price per share/i), '5')
    await user.click(screen.getByRole('button', { name: /^add grant$/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ instrument_type: 'share', strike_price_cents: null }),
      ),
    )
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<EquityGrantForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/^label$/i), 'Grant')
    await user.type(screen.getByLabelText(/^quantity$/i), '10')
    await user.type(screen.getByLabelText(/price per share/i), '1')
    await user.click(screen.getByRole('button', { name: /^add grant$/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('ignores a submit while the form is incomplete', () => {
    const onSubmit = vi.fn()
    const { container } = render(<EquityGrantForm member={member} onSubmit={onSubmit} />)

    fireEvent.submit(container.querySelector('form')!)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('prefills an existing grant and cancels', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <EquityGrantForm
        member={member}
        initial={makeGrant()}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByDisplayValue('2023 shares')).toBeInTheDocument()
    // A share grant hides the strike field.
    expect(screen.queryByLabelText(/strike price/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
