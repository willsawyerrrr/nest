import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '../test/render'
import { DerivedBudgetLineForm } from './DerivedBudgetLineForm'

const initial = {
  id: 'l1',
  breakdown_id: 'b1',
  name: 'Gifts',
  line_group: 'wants' as const,
  destination_account_id: null,
  amount_cents: 120_00,
  frequency: 'annual' as const,
  interval_count: null,
  gift_recipient_member_id: null,
}

function renderForm(overrides: Partial<Parameters<typeof DerivedBudgetLineForm>[0]> = {}) {
  render(
    <MemoryRouter>
      <DerivedBudgetLineForm initial={initial} onSave={vi.fn()} {...overrides} />
    </MemoryRouter>,
  )
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('DerivedBudgetLineForm', () => {
  it('seeds the name from the breakdown and links out to the breakdown page', () => {
    renderForm()
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('Gifts')
    expect(screen.getByRole('link', { name: /edit in breakdown/i })).toHaveAttribute(
      'href',
      '/breakdowns/b1',
    )
  })

  it('saves the name, group, and funding account', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderForm({ accounts: [{ id: 'acc1', name: 'Everyday' }], onSave })

    const nameInput = screen.getByRole('textbox', { name: /name/i })
    await user.clear(nameInput)
    await user.type(nameInput, 'Christmas gifts')
    await selectOption(user, /group/i, 'Needs')
    await user.click(screen.getByRole('combobox', { name: /funded from/i }))
    await user.click(await screen.findByRole('option', { name: 'Everyday' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'Christmas gifts',
        line_group: 'needs',
        destination_account_id: 'acc1',
      }),
    )
  })

  it('keeps submit disabled and ignores a submit while the name is blank', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <DerivedBudgetLineForm initial={initial} onSave={onSave} />
      </MemoryRouter>,
    )

    await user.clear(screen.getByRole('textbox', { name: /name/i }))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()

    const form = container.querySelector('form') as HTMLFormElement
    form.requestSubmit()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows an error when the save fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('nope'))
    renderForm({ onSave })

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save this budget item/i)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  it('shows the name read-only and still saves when name editing is off', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderForm({ initial: { ...initial, name: 'Gifts for Sam' }, nameEditable: false, onSave })

    // No editable name field; the partition name shows as static text.
    expect(screen.queryByRole('textbox', { name: /name/i })).not.toBeInTheDocument()
    expect(screen.getByText('Gifts for Sam')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'Gifts for Sam',
        line_group: 'wants',
        destination_account_id: null,
      }),
    )
  })

  it('locks the funding picker for a gift member line, showing a read-only note', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderForm({
      initial: {
        ...initial,
        name: 'Gifts for Sam',
        gift_recipient_member_id: 'm-sam',
        destination_account_id: 'will-txn',
      },
      accounts: [{ id: 'will-txn', name: 'Will’s Spending' }],
      nameEditable: false,
      onSave,
    })

    // No editable funding Select; a read-only note explains the auto-routing.
    expect(screen.queryByRole('combobox', { name: /funded from/i })).not.toBeInTheDocument()
    expect(screen.getByText(/automatically from the buyer's spending account/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'Gifts for Sam',
        line_group: 'wants',
        destination_account_id: 'will-txn',
      }),
    )
  })

  it('calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderForm({ onCancel })

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
