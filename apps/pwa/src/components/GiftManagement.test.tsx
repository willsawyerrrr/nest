import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GiftOccasion, GiftRecipient } from '../hooks/useGifts'
import { fireEvent, render, screen, waitFor, within } from '../test/render'
import { GiftManagement } from './GiftManagement'

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const xmas: GiftOccasion = {
  id: 'o1',
  name: 'Christmas',
  occasion_date: '2026-12-25',
  household_id: 'h',
  created_at: '',
  updated_at: '',
}
const bday: GiftOccasion = { ...xmas, id: 'o2', name: 'Birthday', occasion_date: null }

function renderManagement(overrides: Partial<Parameters<typeof GiftManagement>[0]> = {}) {
  return render(
    <GiftManagement
      recipients={[]}
      occasions={[]}
      onCreateRecipient={vi.fn()}
      onUpdateRecipient={vi.fn()}
      onDeleteRecipient={vi.fn()}
      onCreateOccasion={vi.fn()}
      onUpdateOccasion={vi.fn()}
      onDeleteOccasion={vi.fn()}
      {...overrides}
    />,
  )
}

describe('GiftManagement', () => {
  it('shows empty states when there are no recipients or occasions', () => {
    renderManagement()
    expect(screen.getByText('No recipients yet.')).toBeInTheDocument()
    expect(screen.getByText('No occasions yet.')).toBeInTheDocument()
  })

  it('lists recipients and occasions, showing an occasion date only when set', () => {
    renderManagement({ recipients: [alice], occasions: [xmas, bday] })
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Christmas')).toBeInTheDocument()
    expect(screen.getByText('25 Dec 2026')).toBeInTheDocument()
    expect(screen.getByText('Birthday')).toBeInTheDocument()
  })

  it('adds a recipient, with submit disabled until a name is entered', async () => {
    const user = userEvent.setup()
    const onCreateRecipient = vi.fn()
    renderManagement({ onCreateRecipient })

    await user.click(screen.getByRole('button', { name: 'Add recipient' }))
    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()

    await user.type(screen.getByLabelText('Name'), 'Carol')
    await user.click(add)

    await waitFor(() => expect(onCreateRecipient).toHaveBeenCalledWith({ name: 'Carol' }))
  })

  it('adds an occasion with no date', async () => {
    const user = userEvent.setup()
    const onCreateOccasion = vi.fn()
    renderManagement({ onCreateOccasion })

    await user.click(screen.getByRole('button', { name: 'Add occasion' }))
    await user.type(screen.getByLabelText('Name'), 'Easter')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(onCreateOccasion).toHaveBeenCalledWith({ name: 'Easter', occasion_date: null }),
    )
  })

  it('edits a recipient', async () => {
    const user = userEvent.setup()
    const onUpdateRecipient = vi.fn()
    renderManagement({ recipients: [alice], onUpdateRecipient })

    await user.click(screen.getByRole('button', { name: 'Edit Alice' }))
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Alicia')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onUpdateRecipient).toHaveBeenCalledWith('r1', { name: 'Alicia' }))
  })

  it('edits an occasion, keeping its date', async () => {
    const user = userEvent.setup()
    const onUpdateOccasion = vi.fn()
    renderManagement({ occasions: [xmas], onUpdateOccasion })

    await user.click(screen.getByRole('button', { name: 'Edit Christmas' }))
    expect(screen.getByLabelText('Date')).toHaveValue('25 Dec 2026')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(onUpdateOccasion).toHaveBeenCalledWith('o1', {
        name: 'Christmas',
        occasion_date: '2026-12-25',
      }),
    )
  })

  it('cancels adding a recipient', async () => {
    const user = userEvent.setup()
    renderManagement()

    await user.click(screen.getByRole('button', { name: 'Add recipient' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Add recipient' })).toBeInTheDocument()
  })

  it('cancels adding an occasion', async () => {
    const user = userEvent.setup()
    renderManagement()

    await user.click(screen.getByRole('button', { name: 'Add occasion' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Add occasion' })).toBeInTheDocument()
  })

  it('cancels editing a recipient', async () => {
    const user = userEvent.setup()
    renderManagement({ recipients: [alice] })

    await user.click(screen.getByRole('button', { name: 'Edit Alice' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Edit Alice' })).toBeInTheDocument()
  })

  it('cancels editing an occasion', async () => {
    const user = userEvent.setup()
    renderManagement({ occasions: [xmas] })

    await user.click(screen.getByRole('button', { name: 'Edit Christmas' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Edit Christmas' })).toBeInTheDocument()
  })

  it('ignores a submit while the form is invalid', async () => {
    const user = userEvent.setup()
    const onCreateRecipient = vi.fn()
    renderManagement({ onCreateRecipient })

    await user.click(screen.getByRole('button', { name: 'Add recipient' }))
    const form = screen.getByLabelText('Name').closest('form') as HTMLElement
    fireEvent.submit(form)

    expect(onCreateRecipient).not.toHaveBeenCalled()
  })

  it('confirms before deleting a recipient, warning about the cascade', async () => {
    const user = userEvent.setup()
    const onDeleteRecipient = vi.fn()
    renderManagement({ recipients: [alice], onDeleteRecipient })

    await user.click(screen.getByRole('button', { name: 'Delete Alice' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/also removes its gift budgets/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDeleteRecipient).toHaveBeenCalledWith('r1'))
  })

  it('confirms before deleting an occasion', async () => {
    const user = userEvent.setup()
    const onDeleteOccasion = vi.fn()
    renderManagement({ occasions: [xmas], onDeleteOccasion })

    await user.click(screen.getByRole('button', { name: 'Delete Christmas' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDeleteOccasion).toHaveBeenCalledWith('o1'))
  })

  it('shows an error when saving fails', async () => {
    const user = userEvent.setup()
    const onCreateRecipient = vi.fn().mockRejectedValue(new Error('boom'))
    renderManagement({ onCreateRecipient })

    await user.click(screen.getByRole('button', { name: 'Add recipient' }))
    await user.type(screen.getByLabelText('Name'), 'Carol')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
  })
})
