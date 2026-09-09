import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeInflow, makeMember } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
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

describe('InflowForm one-off mode', () => {
  it('submits a taxable one-off with its date and treatment, and no cadence at all', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.click(screen.getByText('One-off'))
    await user.type(screen.getByLabelText(/name/i), 'Severance')
    await user.type(screen.getByLabelText('Amount'), '40000')
    await user.type(screen.getByLabelText(/paid on/i), '12 Sep 2026')
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Severance',
        taxable: true,
        attracts_super: true,
        member_id: 'm1',
        type: 'salary',
        schedule: null,
        interval_count: null,
        pay_schedule: null,
        pay_interval_count: null,
        arrives_every_pay_period: true,
        amount_cents: 40_000_00,
        hourly_rate_cents: null,
        hours_per_period: null,
        starts_on: null,
        ends_on: null,
        pay_anchor_date: null,
        paid_on: '2026-09-12',
        one_off_tax_treatment: 'ordinary',
        years_of_service: null,
        is_joint: false,
        member_split_percent: null,
      }),
    )
  })

  it('hides every cadence question a one-off cannot answer', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: /frequency/i })).toBeInTheDocument()
    await user.click(screen.getByText('One-off'))

    expect(screen.queryByRole('combobox', { name: /frequency/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /^paid$/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: /arrives in every pay period/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /employer super/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/effective from/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/confirmed payday/i)).not.toBeInTheDocument()
  })

  it('turns a wage into a salary, an amount paid once pricing no hours', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    await selectOption(user, /type/i, 'Wage')
    expect(screen.getByLabelText(/hourly rate/i)).toBeInTheDocument()

    await user.click(screen.getByText('One-off'))
    expect(screen.getByRole('combobox', { name: /type/i })).toHaveValue('Salary')
    expect(screen.queryByLabelText(/hourly rate/i)).not.toBeInTheDocument()
  })

  it('waits for the payment date, and for a redundancy’s years of service', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    await user.click(screen.getByText('One-off'))
    await user.type(screen.getByLabelText(/name/i), 'Redundancy')
    await user.type(screen.getByLabelText('Amount'), '100000')
    const button = screen.getByRole('button', { name: /add inflow/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/paid on/i), '12 Sep 2026')
    expect(button).toBeEnabled()

    await selectOption(user, /tax treatment/i, 'Genuine redundancy')
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText(/completed years of service/i), '10')
    expect(button).toBeEnabled()
  })

  it('opens an existing one-off in one-off mode with its own fields', () => {
    const severance = makeInflow({
      name: 'Redundancy',
      schedule: null,
      paid_on: '2026-09-12',
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 10,
      amount_cents: 100_000_00,
    })
    render(<InflowForm members={members} initial={severance} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/paid on/i)).toHaveValue('12 Sep 2026')
    expect(screen.getByRole('combobox', { name: /tax treatment/i })).toHaveValue(
      'Genuine redundancy',
    )
    expect(screen.getByLabelText(/completed years of service/i)).toHaveValue('10')
  })

  it('gives a non-taxable one-off a date and nothing else to say about tax', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await user.click(screen.getByText('One-off'))
    await user.click(screen.getByText('Non-taxable inflow'))
    await user.type(screen.getByLabelText(/name/i), 'Wedding gift')
    await user.type(screen.getByLabelText('Amount'), '500')
    await user.type(screen.getByLabelText(/paid on/i), '12 Sep 2026')
    expect(screen.queryByRole('combobox', { name: /tax treatment/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          taxable: false,
          paid_on: '2026-09-12',
          one_off_tax_treatment: null,
          years_of_service: null,
          // A one-off carries no effective window, whatever its taxability.
          starts_on: null,
          ends_on: null,
        }),
      ),
    )
  })
})

describe('InflowForm joint income', () => {
  const fillNameAndAmount = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(/name/i), 'Rental')
    await user.type(screen.getByLabelText(/amount per/i), '20000')
  }

  it('shows the joint switch only for a recurring taxable other inflow', async () => {
    const user = userEvent.setup({ delay: null })
    render(<InflowForm members={members} onSubmit={vi.fn()} />)

    // Salary: no switch.
    expect(screen.queryByLabelText(/joint income/i)).not.toBeInTheDocument()

    await selectOption(user, /type/i, 'Other')
    expect(screen.getByLabelText(/joint income/i)).toBeInTheDocument()

    // One-off: gone.
    await user.click(screen.getByText('One-off'))
    expect(screen.queryByLabelText(/joint income/i)).not.toBeInTheDocument()

    // Recurring non-taxable: gone.
    await user.click(screen.getByText('Recurring'))
    await user.click(screen.getByText('Non-taxable inflow'))
    expect(screen.queryByLabelText(/joint income/i)).not.toBeInTheDocument()
  })

  it('saves the split percentage and shows the other member’s share back', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await selectOption(user, /type/i, 'Other')
    await fillNameAndAmount(user)
    await user.click(screen.getByLabelText(/joint income/i))

    const split = screen.getByLabelText(/split — % to will/i)
    expect(split).toHaveValue('50')
    await user.clear(split)
    await user.type(split, '70')
    expect(screen.getByText(/sam: 30%/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'other', is_joint: true, member_split_percent: 70 }),
      ),
    )
  })

  it('stores neither field when the switch is left off', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await selectOption(user, /type/i, 'Other')
    await fillNameAndAmount(user)
    await user.click(screen.getByRole('button', { name: /add inflow/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ is_joint: false, member_split_percent: null }),
      ),
    )
  })

  it('clears the joint choice when the type moves off other', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    render(<InflowForm members={members} onSubmit={onSubmit} />)

    await selectOption(user, /type/i, 'Other')
    await fillNameAndAmount(user)
    await user.click(screen.getByLabelText(/joint income/i))
    await selectOption(user, /type/i, 'Salary')
    expect(screen.queryByLabelText(/joint income/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add inflow/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'salary', is_joint: false, member_split_percent: null }),
      ),
    )
  })

  it('round-trips an existing joint inflow into the form', async () => {
    const user = userEvent.setup({ delay: null })
    const onSubmit = vi.fn()
    const joint = makeInflow({
      name: 'Joint dividends',
      type: 'other',
      schedule: 'annual',
      amount_cents: 12_000_00,
      is_joint: true,
      member_split_percent: 40,
    })
    render(<InflowForm members={members} initial={joint} onSubmit={onSubmit} />)

    expect(screen.getByLabelText(/joint income/i)).toBeChecked()
    expect(screen.getByLabelText(/split — % to will/i)).toHaveValue('40')

    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ is_joint: true, member_split_percent: 40 }),
      ),
    )
  })
})
