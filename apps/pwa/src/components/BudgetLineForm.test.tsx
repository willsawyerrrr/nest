import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { BudgetLineForm } from './BudgetLineForm'

/** Picks an option from a Mantine `Select` identified by its label. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('BudgetLineForm', () => {
  it('submits a new line with dollars converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BudgetLineForm defaultGroup="wants" onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Dining out')
    await user.type(screen.getByLabelText(/amount/i), '250.50')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        line_group: 'wants',
        name: 'Dining out',
        amount_cents: 25050,
        frequency: 'fortnightly',
        interval_count: null,
        goal_id: null,
        breakdown_id: null,
        destination_account_id: null,
        gift_recipient_member_id: null,
      }),
    )
  })

  it('submits a savings line with a null goal', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BudgetLineForm onSubmit={onSubmit} />)

    await selectOption(user, /group/i, 'Savings')
    await user.type(screen.getByLabelText(/name/i), 'Emergency fund')
    await selectOption(user, /frequency/i, 'Monthly')
    await user.type(screen.getByLabelText(/amount/i), '400')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        line_group: 'savings',
        name: 'Emergency fund',
        amount_cents: 40000,
        frequency: 'monthly',
        interval_count: null,
        goal_id: null,
        breakdown_id: null,
        destination_account_id: null,
        gift_recipient_member_id: null,
      }),
    )
  })

  it('submits an every-N-weeks line with its interval', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BudgetLineForm defaultGroup="needs" onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Bin night')
    await selectOption(user, /frequency/i, 'Every N weeks')
    await user.type(screen.getByLabelText(/weeks between allocations/i), '4')
    await user.type(screen.getByLabelText(/amount/i), '20')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        line_group: 'needs',
        name: 'Bin night',
        amount_cents: 2000,
        frequency: 'every_n_weeks',
        interval_count: 4,
        goal_id: null,
        breakdown_id: null,
        destination_account_id: null,
        gift_recipient_member_id: null,
      }),
    )
  })

  it('submits an every-N-months line with its interval', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BudgetLineForm defaultGroup="needs" onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Car service')
    await selectOption(user, /frequency/i, 'Every N months')
    await user.type(screen.getByLabelText(/months between allocations/i), '6')
    await user.type(screen.getByLabelText(/amount/i), '300')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        line_group: 'needs',
        name: 'Car service',
        amount_cents: 30000,
        frequency: 'every_n_months',
        interval_count: 6,
        goal_id: null,
        breakdown_id: null,
        destination_account_id: null,
        gift_recipient_member_id: null,
      }),
    )
  })

  it('keeps submit disabled on an every-N-months line until the interval is valid', async () => {
    const user = userEvent.setup()
    render(<BudgetLineForm defaultGroup="needs" onSubmit={vi.fn()} />)

    await user.type(screen.getByLabelText(/name/i), 'Car service')
    await selectOption(user, /frequency/i, 'Every N months')
    await user.type(screen.getByLabelText(/amount/i), '300')

    const button = screen.getByRole('button', { name: /add line/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/months between allocations/i), '6')
    expect(button).toBeEnabled()
  })

  it('keeps submit disabled on an every-N-weeks line until the interval is valid', async () => {
    const user = userEvent.setup()
    render(<BudgetLineForm defaultGroup="needs" onSubmit={vi.fn()} />)

    await user.type(screen.getByLabelText(/name/i), 'Bin night')
    await selectOption(user, /frequency/i, 'Every N weeks')
    await user.type(screen.getByLabelText(/amount/i), '20')

    const button = screen.getByRole('button', { name: /add line/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/weeks between allocations/i), '4')
    expect(button).toBeEnabled()
  })

  it('disables submit until required fields are filled', async () => {
    const user = userEvent.setup()
    render(<BudgetLineForm onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add line/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Rent')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/amount/i), '1000')
    expect(button).toBeEnabled()
  })

  it('prefills fields from an existing line when editing', () => {
    const line = makeBudgetLine({
      line_group: 'needs',
      name: 'Rent',
      amount_cents: 200000,
      frequency: 'monthly',
    })
    render(<BudgetLineForm initial={line} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Rent')
    expect(screen.getByRole('combobox', { name: /group/i })).toHaveValue('Needs')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$2,000.00')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
  })

  it('hides the goal picker for non-savings groups', () => {
    render(
      <BudgetLineForm
        defaultGroup="needs"
        goals={[{ id: 'g1', name: 'House deposit' }]}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox', { name: /goal/i })).not.toBeInTheDocument()
  })

  it('shows the goal picker for savings and investments groups', () => {
    render(
      <BudgetLineForm
        defaultGroup="investments"
        goals={[{ id: 'g1', name: 'House deposit' }]}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: /goal/i })).toBeInTheDocument()
  })

  it('links a savings line to a chosen goal', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <BudgetLineForm
        defaultGroup="savings"
        goals={[{ id: 'g1', name: 'House deposit' }]}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/name/i), 'Deposit saver')
    await user.type(screen.getByLabelText(/amount/i), '500')
    await selectOption(user, /goal/i, 'House deposit')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ goal_id: 'g1' })),
    )
  })

  it('clears the goal link when the group changes away from savings', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <BudgetLineForm
        defaultGroup="savings"
        goals={[{ id: 'g1', name: 'House deposit' }]}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/name/i), 'Rent')
    await user.type(screen.getByLabelText(/amount/i), '500')
    await selectOption(user, /goal/i, 'House deposit')
    await selectOption(user, /group/i, 'Needs')
    expect(screen.queryByRole('combobox', { name: /goal/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ line_group: 'needs', goal_id: null }),
      ),
    )
  })

  it('shows the funded-from picker for non-savings groups', () => {
    render(
      <BudgetLineForm
        defaultGroup="needs"
        accounts={[{ id: 'a1', name: 'Everyday' }]}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: /funded from/i })).toBeInTheDocument()
  })

  it('hides the funded-from picker for savings and investments groups', () => {
    render(
      <BudgetLineForm
        defaultGroup="savings"
        accounts={[{ id: 'a1', name: 'Everyday' }]}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox', { name: /funded from/i })).not.toBeInTheDocument()
  })

  it('routes a non-savings line to a chosen account', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <BudgetLineForm
        defaultGroup="needs"
        accounts={[{ id: 'a1', name: 'Everyday' }]}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/name/i), 'Rent')
    await user.type(screen.getByLabelText(/amount/i), '1000')
    await selectOption(user, /funded from/i, 'Everyday')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ destination_account_id: 'a1' }),
      ),
    )
  })

  it('filters the funded-from accounts as the user searches', async () => {
    const user = userEvent.setup()
    render(
      <BudgetLineForm
        defaultGroup="needs"
        accounts={[
          { id: 'a1', name: 'Everyday' },
          { id: 'a2', name: 'Holiday saver' },
        ]}
        onSubmit={vi.fn()}
      />,
    )

    const combobox = screen.getByRole('combobox', { name: /funded from/i })
    await user.click(combobox)
    expect(screen.getByRole('option', { name: 'Everyday' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Holiday saver' })).toBeInTheDocument()

    await user.type(combobox, 'Holi')
    expect(screen.queryByRole('option', { name: 'Everyday' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Holiday saver' })).toBeInTheDocument()
  })

  it('clears the funded-from account when the group changes to savings', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <BudgetLineForm
        defaultGroup="needs"
        accounts={[{ id: 'a1', name: 'Everyday' }]}
        goals={[{ id: 'g1', name: 'House deposit' }]}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText(/name/i), 'Rent')
    await user.type(screen.getByLabelText(/amount/i), '1000')
    await selectOption(user, /funded from/i, 'Everyday')
    await selectOption(user, /group/i, 'Savings')
    expect(screen.queryByRole('combobox', { name: /funded from/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add line/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ line_group: 'savings', destination_account_id: null }),
      ),
    )
  })

  it('ignores a submit while invalid', () => {
    const onSubmit = vi.fn()
    const { container } = render(<BudgetLineForm defaultGroup="needs" onSubmit={onSubmit} />)

    const form = container.querySelector('form') as HTMLFormElement
    form.requestSubmit()

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows an error when the save fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('nope'))
    render(<BudgetLineForm defaultGroup="needs" onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Rent')
    await user.type(screen.getByLabelText(/amount/i), '1000')
    await user.click(screen.getByRole('button', { name: /add line/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save this budget line/i)
    expect(screen.getByRole('button', { name: /add line/i })).toBeEnabled()
  })

  it('preserves an existing line goal link on edit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const line = makeBudgetLine({
      line_group: 'savings',
      name: 'House deposit',
      amount_cents: 50000,
      goal_id: 'g1',
    })
    render(<BudgetLineForm initial={line} onSubmit={onSubmit} />)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ goal_id: 'g1' })),
    )
  })
})
