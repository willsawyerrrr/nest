import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DeductionRow } from '../hooks/useDeductions'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { DeductionForm } from './DeductionForm'

const member = { id: 'm1', name: 'Will' }

function makeDeduction(overrides: Partial<DeductionRow> = {}): DeductionRow {
  return {
    id: 'd1',
    household_id: 'h1',
    member_id: 'm1',
    description: 'Home office',
    amount_cents: 1_200_00,
    deduction_date: '2026-08-01',
    financial_year: 2027,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('DeductionForm', () => {
  it('submits a deduction with the amount in cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DeductionForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/description/i), 'Tools')
    await user.type(screen.getByLabelText(/amount/i), '350')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          member_id: 'm1',
          description: 'Tools',
          amount_cents: 35000,
        }),
      ),
    )
    expect(onSubmit.mock.calls[0]![0].deduction_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<DeductionForm member={member} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/description/i), 'Tools')
    await user.type(screen.getByLabelText(/amount/i), '10')
    await user.click(screen.getByRole('button', { name: /add deduction/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('ignores a submit while the form is incomplete', () => {
    const onSubmit = vi.fn()
    const { container } = render(<DeductionForm member={member} onSubmit={onSubmit} />)

    fireEvent.submit(container.querySelector('form')!)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('prefills an existing deduction and cancels', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <DeductionForm
        member={member}
        initial={makeDeduction()}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByDisplayValue('Home office')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
