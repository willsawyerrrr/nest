import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeInflow, makeMember } from '../test/fixtures'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { InflowForm } from './InflowForm'

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
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '1234.56')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Day job',
        taxable: true,
        attracts_super: true,
        member_id: 'm1',
        type: 'salary',
        schedule: 'fortnightly',
        interval_count: null,
        pay_schedule: null,
        pay_interval_count: null,
        arrives_every_pay_period: true,
        amount_cents: 123456,
        hourly_rate_cents: null,
        hours_per_period: null,
        starts_on: null,
        ends_on: null,
        pay_anchor_date: null,
        paid_on: null,
        one_off_tax_treatment: null,
        years_of_service: null,
        is_joint: false,
        member_split_percent: null,
      }),
    )
  })

  it('submits a taxable wage inflow with rate and hours', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Shifts')
    await selectOption(user, /type/i, 'Wage')
    await user.type(screen.getByLabelText(/hourly rate/i), '45')
    await user.type(screen.getByLabelText(/hours per fortnight/i), '38')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Shifts',
        taxable: true,
        attracts_super: true,
        member_id: 'm1',
        type: 'wage',
        schedule: 'fortnightly',
        interval_count: null,
        pay_schedule: null,
        pay_interval_count: null,
        arrives_every_pay_period: true,
        amount_cents: null,
        hourly_rate_cents: 4500,
        hours_per_period: 38,
        starts_on: null,
        ends_on: null,
        pay_anchor_date: null,
        paid_on: null,
        one_off_tax_treatment: null,
        years_of_service: null,
        is_joint: false,
        member_split_percent: null,
      }),
    )
  })

  it('submits a non-taxable inflow with no member tag as a reimbursement', async () => {
    const user = userEvent.setup({ delay: null })
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
        attracts_super: true,
        member_id: null,
        type: 'reimbursement',
        schedule: 'fortnightly',
        interval_count: null,
        pay_schedule: null,
        pay_interval_count: null,
        arrives_every_pay_period: true,
        amount_cents: 8000,
        hourly_rate_cents: null,
        hours_per_period: null,
        starts_on: null,
        ends_on: null,
        pay_anchor_date: null,
        paid_on: null,
        one_off_tax_treatment: null,
        years_of_service: null,
        is_joint: false,
        member_split_percent: null,
      }),
    )
  })

  it('persists a chosen non-taxable type', async () => {
    const user = userEvent.setup({ delay: null })
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
    const user = userEvent.setup({ delay: null })
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

  it('submits an allowance the employer pays no super on', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'On-call (T1)')
    await user.type(screen.getByLabelText(/amount/i), '495.50')
    await user.click(screen.getByRole('switch', { name: /employer super accrues on this/i }))
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'On-call (T1)', taxable: true, attracts_super: false }),
      ),
    )
  })

  it('explains that an allowance is taxed in full but earns no super', () => {
    render(<InflowForm members={members} onSubmit={vi.fn()} />)
    expect(screen.getByText(/taxed in full, but no super accrues on it/i)).toBeInTheDocument()
  })

  it('keeps a saved allowance switched off when editing, and hides the switch when non-taxable', () => {
    const onCall = makeInflow({ id: 'i2', name: 'On-call (T1)', attracts_super: false })
    const { unmount } = render(<InflowForm members={members} initial={onCall} onSubmit={vi.fn()} />)
    expect(screen.getByRole('switch', { name: /employer super/i })).not.toBeChecked()
    unmount()

    // Super never accrues on a non-taxable inflow, so there is nothing to ask.
    render(
      <InflowForm
        members={members}
        initial={makeInflow({ id: 'i3', taxable: false, member_id: null, type: 'gift' })}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('switch', { name: /employer super/i })).not.toBeInTheDocument()
  })

  it('submits an allowance that lands in only some pay periods', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'On-call (T1)')
    await user.type(screen.getByLabelText(/amount/i), '6600')
    await user.click(screen.getByRole('switch', { name: /arrives in every pay period/i }))
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'On-call (T1)', arrives_every_pay_period: false }),
      ),
    )
  })

  it('says the yearly figure still counts in full', () => {
    render(<InflowForm members={members} onSubmit={vi.fn()} />)
    expect(screen.getByText(/yearly figure still counts in full/i)).toBeInTheDocument()
  })

  it('keeps a saved occasional inflow switched off when editing, and hides it when non-taxable', () => {
    const onCall = makeInflow({ id: 'i4', name: 'On-call (T1)', arrives_every_pay_period: false })
    const { unmount } = render(<InflowForm members={members} initial={onCall} onSubmit={vi.fn()} />)
    expect(screen.getByRole('switch', { name: /arrives in every pay period/i })).not.toBeChecked()
    unmount()

    // A non-taxable inflow is never reconciled against a payslip, so no period ever
    // expects it and there is nothing to ask.
    render(
      <InflowForm
        members={members}
        initial={makeInflow({ id: 'i5', taxable: false, member_id: null, type: 'gift' })}
        onSubmit={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('switch', { name: /arrives in every pay period/i }),
    ).not.toBeInTheDocument()
  })

  it('stores a non-taxable inflow as arriving every period whatever was switched before', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('switch', { name: /arrives in every pay period/i }))
    await user.click(screen.getByText('Non-taxable inflow'))
    await user.type(screen.getByLabelText(/name/i), 'Rebate')
    await user.type(screen.getByLabelText(/amount/i), '50')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ taxable: false, arrives_every_pay_period: true }),
      ),
    )
  })

  it('stores a non-taxable inflow as ordinary time earnings whatever was switched before', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('switch', { name: /employer super/i }))
    await user.click(screen.getByText('Non-taxable inflow'))
    await user.type(screen.getByLabelText(/name/i), 'Rebate')
    await user.type(screen.getByLabelText(/amount/i), '50')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ taxable: false, attracts_super: true }),
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
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    expect(screen.queryByLabelText(/weeks in a period/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/name/i), 'On-call')
    await user.type(screen.getByLabelText(/amount/i), '300')
    await selectOption(user, /frequency/i, 'Every N weeks')

    const weeks = screen.getByLabelText(/weeks in a period/i)
    expect(weeks).toBeInTheDocument()
    // Without a valid interval the form cannot submit.
    expect(screen.getByRole('button', { name: /add inflow/i })).toBeDisabled()

    await user.type(weeks, '4')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'On-call',
        taxable: true,
        attracts_super: true,
        member_id: 'm1',
        type: 'salary',
        schedule: 'every_n_weeks',
        interval_count: 4,
        pay_schedule: null,
        pay_interval_count: null,
        arrives_every_pay_period: true,
        amount_cents: 30000,
        hourly_rate_cents: null,
        hours_per_period: null,
        starts_on: null,
        ends_on: null,
        pay_anchor_date: null,
        paid_on: null,
        one_off_tax_treatment: null,
        years_of_service: null,
        is_joint: false,
        member_split_percent: null,
      }),
    )
  })

  it('reveals the months input for the every-N-months cadence and submits the interval', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    expect(screen.queryByLabelText(/months in a period/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/name/i), 'Quarterly bonus')
    await user.type(screen.getByLabelText(/amount/i), '900')
    await selectOption(user, /frequency/i, 'Every N months')

    const months = screen.getByLabelText(/months in a period/i)
    expect(months).toBeInTheDocument()
    // Without a valid interval the form cannot submit.
    expect(screen.getByRole('button', { name: /add inflow/i })).toBeDisabled()

    await user.type(months, '3')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Quarterly bonus',
        taxable: true,
        attracts_super: true,
        member_id: 'm1',
        type: 'salary',
        schedule: 'every_n_months',
        interval_count: 3,
        pay_schedule: null,
        pay_interval_count: null,
        arrives_every_pay_period: true,
        amount_cents: 90000,
        hourly_rate_cents: null,
        hours_per_period: null,
        starts_on: null,
        ends_on: null,
        pay_anchor_date: null,
        paid_on: null,
        one_off_tax_treatment: null,
        years_of_service: null,
        is_joint: false,
        member_split_percent: null,
      }),
    )
  })

  it('prefills and carries effective dates through on submit as ISO strings', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    const inflow = makeInflow({ starts_on: '2026-09-15', ends_on: '2027-06-30' })
    render(<InflowForm members={members} initial={inflow} onSubmit={onSubmit} />)

    expect(screen.getByLabelText(/effective from/i)).toHaveValue('15 Sep 2026')
    expect(screen.getByLabelText(/effective until/i)).toHaveValue('30 Jun 2027')

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ starts_on: '2026-09-15', ends_on: '2027-06-30' }),
      ),
    )
  })

  it('prefills and carries a confirmed payday through on submit as an ISO string', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    const inflow = makeInflow({ pay_anchor_date: '2026-09-11' })
    render(<InflowForm members={members} initial={inflow} onSubmit={onSubmit} />)

    expect(screen.getByLabelText(/confirmed payday/i)).toHaveValue('11 Sep 2026')

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ pay_anchor_date: '2026-09-11' }),
      ),
    )
  })

  it('leaves an unset confirmed payday blank and null on submit', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    expect(screen.getByLabelText(/confirmed payday/i)).toHaveValue('')

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '100')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ pay_anchor_date: null })),
    )
  })

  it('keeps the effective-date inputs on the non-taxable branch', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/effective from/i)).toBeInTheDocument()
    await user.click(screen.getByText('Non-taxable inflow'))
    expect(screen.getByLabelText(/effective from/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/effective until/i)).toBeInTheDocument()
  })

  it('carries a non-taxable recurring inflow’s effective dates through on submit', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.click(screen.getByText('Non-taxable inflow'))
    await user.type(screen.getByLabelText(/name/i), 'Project reimbursement')
    await user.type(screen.getByLabelText(/amount/i), '80')
    await user.type(screen.getByLabelText(/effective from/i), '15 Sep 2026')
    await user.type(screen.getByLabelText(/effective until/i), '30 Jun 2027')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          taxable: false,
          starts_on: '2026-09-15',
          ends_on: '2027-06-30',
        }),
      ),
    )
  })

  it('prefills and round-trips a non-taxable inflow’s effective dates when editing', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    const inflow = makeInflow({
      taxable: false,
      member_id: null,
      type: 'reimbursement',
      starts_on: '2026-09-15',
      ends_on: '2027-06-30',
    })
    render(<InflowForm members={members} initial={inflow} onSubmit={onSubmit} />)

    expect(screen.getByLabelText(/effective from/i)).toHaveValue('15 Sep 2026')
    expect(screen.getByLabelText(/effective until/i)).toHaveValue('30 Jun 2027')

    await user.clear(screen.getByLabelText(/effective until/i))
    await user.type(screen.getByLabelText(/effective until/i), '31 Dec 2026')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          taxable: false,
          starts_on: '2026-09-15',
          ends_on: '2026-12-31',
        }),
      ),
    )
  })

  it('disables submit until required fields are filled', async () => {
    const user = userEvent.setup({ delay: null })
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

  it('ignores a form submit while required fields are missing', () => {
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    fireEvent.submit(
      screen.getByRole('button', { name: /add inflow/i }).closest('form') as HTMLFormElement,
    )

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('tags the inflow to the chosen member', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '100')
    await selectOption(user, /member/i, 'Sam')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ member_id: 'm2' })),
    )
  })

  it('keeps a yearly salary yearly and records the fortnightly cycle it lands on', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await selectOption(user, /frequency/i, 'Annually')
    await user.type(screen.getByLabelText(/amount per year/i), '130000')
    await selectOption(user, /^paid$/i, 'Fortnightly')

    expect(screen.getByText('That is $5,000.00 each fortnight.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    // The amount and its own frequency are stored exactly as stated — nothing is
    // divided away — and the pay cycle is recorded beside them.
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: 'annual',
          interval_count: null,
          amount_cents: 13_000_000,
          pay_schedule: 'fortnightly',
          pay_interval_count: null,
        }),
      ),
    )
  })

  it('reopens a yearly-amount fortnightly-paid inflow on both its frequencies', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    const inflow = makeInflow({
      schedule: 'annual',
      amount_cents: 130_000_00,
      pay_schedule: 'fortnightly',
    })
    render(<InflowForm members={members} initial={inflow} onSubmit={onSubmit} />)

    expect(screen.getByRole('combobox', { name: /frequency/i })).toHaveValue('Annually')
    expect(screen.getByRole('combobox', { name: /^paid$/i })).toHaveValue('Fortnightly')
    expect(screen.getByLabelText(/amount per year/i)).toHaveValue('$130,000.00')
    expect(screen.getByText('That is $5,000.00 each fortnight.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: 'annual',
          amount_cents: 13_000_000,
          pay_schedule: 'fortnightly',
          pay_interval_count: null,
        }),
      ),
    )
  })

  it('names the shortfall where a year of payments cannot reach the amount stated', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await selectOption(user, /frequency/i, 'Annually')
    await user.type(screen.getByLabelText(/amount per year/i), '100000')
    await selectOption(user, /^paid$/i, 'Fortnightly')

    expect(
      screen.getByText(
        'That is $3,846.15 each fortnight. A year of those payments comes to $99,999.90, $0.10 under the $100,000.00 stated, because each payment rounds to the nearest cent.',
      ),
    ).toBeInTheDocument()

    // The rounding is in the derived per-payment figure alone: the row still holds the
    // whole $100,000.00 the member stated.
    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ schedule: 'annual', amount_cents: 10_000_000 }),
      ),
    )
  })

  it('names the overshoot where a year of monthly payments passes the amount stated', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    await selectOption(user, /frequency/i, 'Annually')
    await user.type(screen.getByLabelText(/amount per year/i), '50000')
    await selectOption(user, /^paid$/i, 'Monthly')

    expect(
      screen.getByText(
        'That is $4,166.67 each month. A year of those payments comes to $50,000.04, $0.04 over the $50,000.00 stated, because each payment rounds to the nearest cent.',
      ),
    ).toBeInTheDocument()
  })

  it('gathers a weekly amount into the fortnight it is paid in', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await selectOption(user, /frequency/i, 'Weekly')
    await user.type(screen.getByLabelText(/amount per week/i), '1000')
    await selectOption(user, /^paid$/i, 'Fortnightly')

    expect(screen.getByText('That is $2,000.00 each fortnight.')).toBeInTheDocument()
    expect(screen.queryByText(/rounds to the nearest cent/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: 'weekly',
          amount_cents: 100_000,
          pay_schedule: 'fortnightly',
        }),
      ),
    )
  })

  it('takes an interval for an arbitrary pay cadence and waits for it before saving', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'On-call')
    await selectOption(user, /frequency/i, 'Annually')
    await user.type(screen.getByLabelText(/amount per year/i), '13000')
    await selectOption(user, /^paid$/i, 'Every N weeks')

    // Until the interval is given there is no pay cycle to divide by, and nothing to say.
    expect(screen.queryByText(/That is/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add inflow/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/weeks between payments/i), '4')
    expect(screen.getByText('That is $1,000.00 each payment.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: 'annual',
          interval_count: null,
          amount_cents: 1_300_000,
          pay_schedule: 'every_n_weeks',
          pay_interval_count: 4,
        }),
      ),
    )
  })

  it('keeps the amount’s own every-N interval separate from the pay cadence’s', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'On-call')
    await selectOption(user, /frequency/i, 'Every N weeks')
    await user.type(screen.getByLabelText(/weeks in a period/i), '3')
    await user.type(screen.getByLabelText(/amount per period/i), '300')
    await selectOption(user, /^paid$/i, 'Fortnightly')

    // $300 every 3 weeks is $5,200 a year, which arrives as $200.00 a fortnight.
    expect(screen.getByText('That is $200.00 each fortnight.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: 'every_n_weeks',
          interval_count: 3,
          amount_cents: 30_000,
          pay_schedule: 'fortnightly',
          pay_interval_count: null,
        }),
      ),
    )
  })

  it('divides a wage’s rate and hours over the cycle the pay lands on', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Shifts')
    await selectOption(user, /type/i, 'Wage')
    await selectOption(user, /frequency/i, 'Weekly')
    await user.type(screen.getByLabelText(/hourly rate/i), '45')
    await user.type(screen.getByLabelText(/hours per week/i), '38')
    await selectOption(user, /^paid$/i, 'Fortnightly')

    // $45 × 38 hours a week = $1,710 a week, arriving as $3,420.00 a fortnight.
    expect(screen.getByText('That is $3,420.00 each fortnight.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'wage',
          schedule: 'weekly',
          hourly_rate_cents: 4500,
          hours_per_period: 38,
          amount_cents: null,
          pay_schedule: 'fortnightly',
        }),
      ),
    )
  })

  it('says nothing about a per-payment figure for pay that lands in only some periods', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    await selectOption(user, /frequency/i, 'Annually')
    await user.type(screen.getByLabelText(/amount per year/i), '6600')
    await selectOption(user, /^paid$/i, 'Fortnightly')
    expect(screen.getByText(/That is \$253\.85 each fortnight\./)).toBeInTheDocument()

    // No fortnight is held against $253.85 once the money lands in only some of
    // them, so stating the figure would name a share nothing expects.
    await user.click(screen.getByRole('switch', { name: /arrives in every pay period/i }))
    expect(screen.queryByText(/That is/)).not.toBeInTheDocument()
  })

  it('says nothing when the money arrives on the very period the amount covers', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount per fortnight/i), '5000')
    expect(screen.getByRole('combobox', { name: /^paid$/i })).toHaveValue('Same as above')
    expect(screen.queryByText(/That is/)).not.toBeInTheDocument()

    // Saying it explicitly is the same fact, so there is still nothing to derive.
    await selectOption(user, /^paid$/i, 'Fortnightly')
    expect(screen.queryByText(/That is/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ schedule: 'fortnightly', pay_schedule: 'fortnightly' }),
      ),
    )
  })

  it('advises when a salary’s money arrives once a year, without blocking the save', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await selectOption(user, /frequency/i, 'Annually')
    await user.type(screen.getByLabelText(/amount per year/i), '130000')
    expect(screen.getByText(/says the money arrives once a year/)).toBeInTheDocument()

    // Naming the cycle it lands on is exactly what the advice asks for, so it goes away.
    await selectOption(user, /^paid$/i, 'Fortnightly')
    expect(screen.queryByText(/says the money arrives once a year/)).not.toBeInTheDocument()

    // Someone genuinely paid once a year exists, so the advice never blocks the save.
    await selectOption(user, /^paid$/i, 'Same as above')
    const button = screen.getByRole('button', { name: /add inflow/i })
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ schedule: 'annual', pay_schedule: null }),
      ),
    )
  })

  it('leaves the once-a-year advice off a type plausibly paid that way', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    await selectOption(user, /frequency/i, 'Annually')
    await selectOption(user, /type/i, 'Other')
    expect(screen.queryByText(/arrives once a year/)).not.toBeInTheDocument()
  })

  it('leaves the pay cadence off a non-taxable inflow, which no payslip measures', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await selectOption(user, /^paid$/i, 'Monthly')
    await user.click(screen.getByText('Non-taxable inflow'))
    expect(screen.queryByRole('combobox', { name: /^paid$/i })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/name/i), 'Rebate')
    await user.type(screen.getByLabelText(/amount/i), '50')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ taxable: false, pay_schedule: null, pay_interval_count: null }),
      ),
    )
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Day job')
    await user.type(screen.getByLabelText(/amount/i), '100')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
