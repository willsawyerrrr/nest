import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeMemberAllowance } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { MemberAllowanceForm } from './MemberAllowanceForm'

describe('MemberAllowanceForm', () => {
  it('submits an edited allowance with dollars converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <MemberAllowanceForm memberName="Ada" initial={makeMemberAllowance()} onSubmit={onSubmit} />,
    )

    const amount = screen.getByLabelText(/ada’s allowance/i)
    await user.clear(amount)
    await user.type(amount, '150.50')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        amount_cents: 150_50,
        frequency: 'fortnightly',
        interval_count: null,
        destination_account_id: null,
      }),
    )
  })

  it('submits the chosen frequency', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <MemberAllowanceForm memberName="Ada" initial={makeMemberAllowance()} onSubmit={onSubmit} />,
    )

    await user.click(screen.getByRole('combobox', { name: /frequency/i }))
    await user.click(await screen.findByRole('option', { name: 'Monthly' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: 'monthly', interval_count: null }),
      ),
    )
  })

  it('allows an amount of zero but needs an amount', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <MemberAllowanceForm memberName="Ada" initial={makeMemberAllowance()} onSubmit={onSubmit} />,
    )

    const amount = screen.getByLabelText(/ada’s allowance/i)
    await user.clear(amount)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount_cents: 0 })),
    )
  })

  it('asks for the interval on an every-N-weeks cadence', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <MemberAllowanceForm
        memberName="Ada"
        initial={makeMemberAllowance({ frequency: 'every_n_weeks', interval_count: 3 })}
        onSubmit={onSubmit}
      />,
    )

    const weeks = screen.getByLabelText(/weeks between allowances/i)
    expect(weeks).toHaveValue('3')
    await user.clear(weeks)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    await user.type(weeks, '4')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: 'every_n_weeks', interval_count: 4 }),
      ),
    )
  })

  it('routes the allowance to a funding account', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <MemberAllowanceForm
        memberName="Ada"
        initial={makeMemberAllowance()}
        accounts={[{ id: 'a1', name: 'Everyday' }]}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /funded from/i }))
    await user.click(await screen.findByRole('option', { name: 'Everyday' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ destination_account_id: 'a1' }),
      ),
    )
  })

  it('shows a failed save', async () => {
    const user = userEvent.setup()
    render(
      <MemberAllowanceForm
        memberName="Ada"
        initial={makeMemberAllowance()}
        onSubmit={vi.fn().mockRejectedValue(new Error('nope'))}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByText(/could not save this allowance/i)).toBeInTheDocument()
  })
})
