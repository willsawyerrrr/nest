import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../test/render'
import { InflowForm } from './InflowForm'
import { makeInflow, makeMember } from '../test/fixtures'

const members = [
  makeMember({ id: 'm1', name: 'Will', user_id: 'u1' }),
  makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' }),
]

/** Picks an option from a Mantine `Select` identified by its label. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('InflowForm', () => {
  it('submits a taxable salary inflow with dollars converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '1234.56')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Day job',
        taxable: true,
        member_id: 'm1',
        type: 'salary',
        schedule: 'fortnightly',
        interval_weeks: null,
        amount_cents: 123456,
        hourly_rate_cents: null,
        hours_per_period: null,
      }),
    )
  })

  it('submits a taxable wage inflow with rate and hours', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Shifts')
    await selectOption(user, /type/i, 'Wage')
    await user.type(screen.getByLabelText(/hourly rate/i), '45')
    await user.type(screen.getByLabelText(/hours per period/i), '38')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Shifts',
        taxable: true,
        member_id: 'm1',
        type: 'wage',
        schedule: 'fortnightly',
        interval_weeks: null,
        amount_cents: null,
        hourly_rate_cents: 4500,
        hours_per_period: 38,
      }),
    )
  })

  it('submits a non-taxable inflow with no member tag as a reimbursement', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.click(screen.getByText('Non-taxable inflow'))
    expect(screen.queryByRole('combobox', { name: /member/i })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/name/i), 'Travel reimbursement')
    await user.type(screen.getByLabelText(/amount/i), '80')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Travel reimbursement',
        taxable: false,
        member_id: null,
        type: 'reimbursement',
        schedule: 'fortnightly',
        interval_weeks: null,
        amount_cents: 8000,
        hourly_rate_cents: null,
        hours_per_period: null,
      }),
    )
  })

  it('persists a chosen non-taxable type', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.click(screen.getByText('Non-taxable inflow'))
    await user.type(screen.getByLabelText(/name/i), 'Side gig')
    await selectOption(user, /type/i, 'Hobby income')
    await user.type(screen.getByLabelText(/amount/i), '120')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Side gig', taxable: false, type: 'hobby' }),
      ),
    )
  })

  it('resets the type to the mode default when toggling taxability drops it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    // Non-taxable → choose gift, then flip back to taxable: gift is invalid there.
    await user.click(screen.getByText('Non-taxable inflow'))
    await selectOption(user, /type/i, 'Gift')
    await user.click(screen.getByText('Taxable income'))
    expect(screen.getByRole('combobox', { name: /type/i })).toHaveValue('Salary')

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '100')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ taxable: true, type: 'salary' }),
      ),
    )
  })

  it('preselects a saved non-taxable type when editing', () => {
    const inflow = makeInflow({
      id: 'i2',
      member_id: null,
      name: 'Etsy shop',
      taxable: false,
      type: 'hobby',
      schedule: 'monthly',
      amount_cents: 15000,
    })
    render(<InflowForm members={members} initial={inflow} onSubmit={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: /type/i })).toHaveValue('Hobby income')
  })

  it('reveals the weeks input for the every-N-weeks cadence and submits the interval', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    expect(screen.queryByLabelText(/weeks between payments/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/name/i), 'On-call')
    await user.type(screen.getByLabelText(/amount/i), '300')
    await selectOption(user, /frequency/i, 'Every N weeks')

    const weeks = screen.getByLabelText(/weeks between payments/i)
    expect(weeks).toBeInTheDocument()
    // Without a valid interval the form cannot submit.
    expect(screen.getByRole('button', { name: /add inflow/i })).toBeDisabled()

    await user.type(weeks, '4')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'On-call',
        taxable: true,
        member_id: 'm1',
        type: 'salary',
        schedule: 'every_n_weeks',
        interval_weeks: 4,
        amount_cents: 30000,
        hourly_rate_cents: null,
        hours_per_period: null,
      }),
    )
  })

  it('disables submit until required fields are filled', async () => {
    const user = userEvent.setup()
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add inflow/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/amount/i), '100')
    expect(button).toBeEnabled()
  })

  it('prefills fields from an existing inflow when editing', () => {
    const inflow = makeInflow({
      member_id: 'm2',
      name: 'Old job',
      schedule: 'monthly',
    })
    render(<InflowForm members={members} initial={inflow} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Old job')
    expect(screen.getByRole('combobox', { name: /member/i })).toHaveValue('Sam')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$5,000.00')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '100')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
