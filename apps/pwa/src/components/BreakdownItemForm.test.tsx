import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import { render, screen, waitFor } from '../test/render'
import { BreakdownItemForm } from './BreakdownItemForm'

function item(overrides: Partial<BreakdownItem> = {}): BreakdownItem {
  return {
    id: 'i1',
    household_id: 'h',
    breakdown_id: 'b1',
    name: 'Vitamin D',
    amount_cents: 10_00,
    frequency: 'monthly',
    interval_weeks: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('BreakdownItemForm', () => {
  it('adds a new item with dollars converted to cents', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BreakdownItemForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Fish oil')
    await user.type(screen.getByLabelText(/amount/i), '15')
    await user.click(screen.getByRole('button', { name: /add item/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Fish oil',
        amount_cents: 15_00,
        frequency: 'fortnightly',
        interval_weeks: null,
      }),
    )
  })

  it('submits an every-N-weeks item with its interval after changing frequency', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<BreakdownItemForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Contacts')
    await selectOption(user, /frequency/i, 'Every N weeks')
    await user.type(screen.getByLabelText(/weeks between allocations/i), '4')
    await user.type(screen.getByLabelText(/amount/i), '20')
    await user.click(screen.getByRole('button', { name: /add item/i }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Contacts',
        amount_cents: 20_00,
        frequency: 'every_n_weeks',
        interval_weeks: 4,
      }),
    )
  })

  it('keeps submit disabled until required fields are filled', async () => {
    const user = userEvent.setup()
    render(<BreakdownItemForm onSubmit={vi.fn()} />)

    const button = screen.getByRole('button', { name: /add item/i })
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/name/i), 'Fish oil')
    expect(button).toBeDisabled()

    await user.type(screen.getByLabelText(/amount/i), '15')
    expect(button).toBeEnabled()
  })

  it('ignores a submit while invalid', () => {
    const onSubmit = vi.fn()
    const { container } = render(<BreakdownItemForm onSubmit={onSubmit} />)

    const form = container.querySelector('form') as HTMLFormElement
    form.requestSubmit()

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows an error when the save fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('nope'))
    render(<BreakdownItemForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/name/i), 'Fish oil')
    await user.type(screen.getByLabelText(/amount/i), '15')
    await user.click(screen.getByRole('button', { name: /add item/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save this item/i)
    expect(screen.getByRole('button', { name: /add item/i })).toBeEnabled()
  })

  it('prefills fields and calls onCancel when editing', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<BreakdownItemForm initial={item()} onSubmit={vi.fn()} onCancel={onCancel} />)

    expect(screen.getByLabelText(/name/i)).toHaveValue('Vitamin D')
    expect(screen.getByLabelText(/amount/i)).toHaveValue('$10.00')

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
