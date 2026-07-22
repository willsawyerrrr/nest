import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GiftOccasion, GiftRecipient } from '../hooks/useGifts'
import { makeMember } from '../test/fixtures'
import { fireEvent, render, screen, waitFor, within } from '../test/render'
import { GiftManagement } from './GiftManagement'

const alice: GiftRecipient = {
  id: 'r1',
  name: 'Alice',
  member_id: null,
  household_id: 'h',
  created_at: '',
  updated_at: '',
}

const will = makeMember({ id: 'm1', name: 'Will' })
const willRecipient: GiftRecipient = { ...alice, id: 'r2', name: 'Will', member_id: 'm1' }

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
      members={[]}
      currentMemberId={null}
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

  it('renders a member recipient as a fixed row with no edit or delete controls', () => {
    renderManagement({ recipients: [willRecipient], members: [will] })

    expect(screen.getByText('Will')).toBeInTheDocument()
    expect(screen.getByText('Household member')).toBeInTheDocument()
    expect(screen.getByText('Purchases hidden from them')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Will' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Will' })).not.toBeInTheDocument()
  })

  it('derives a member recipient label from the live member name, not the stored copy', () => {
    const linked: GiftRecipient = { ...willRecipient, name: 'Old name' }
    renderManagement({ recipients: [linked], members: [makeMember({ id: 'm1', name: 'Willow' })] })

    expect(screen.getByText('Willow')).toBeInTheDocument()
    expect(screen.queryByText('Old name')).not.toBeInTheDocument()
  })

  it('falls back to the stored name when a member recipient has no matching member', () => {
    const linked: GiftRecipient = { ...alice, name: 'Ghost', member_id: 'gone' }
    renderManagement({ recipients: [linked], members: [will] })

    expect(screen.getByText('Ghost')).toBeInTheDocument()
    expect(screen.getByText('Household member')).toBeInTheDocument()
  })

  it('says purchases are hidden from you when the member recipient is the current member', () => {
    renderManagement({ recipients: [willRecipient], members: [will], currentMemberId: 'm1' })

    expect(screen.getByText('Purchases hidden from you')).toBeInTheDocument()
    expect(screen.queryByText('Purchases hidden from them')).not.toBeInTheDocument()
  })

  it('lists member recipients above external ones', () => {
    renderManagement({ recipients: [alice, willRecipient], members: [will] })

    expect(screen.getByText('Will')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // The external recipient keeps its controls; the member one has none.
    expect(screen.getByRole('button', { name: 'Edit Alice' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Will' })).not.toBeInTheDocument()
  })

  it('adds an external recipient with a name field and no member picker', async () => {
    const user = userEvent.setup()
    const onCreateRecipient = vi.fn()
    renderManagement({ members: [will], onCreateRecipient })

    await user.click(screen.getByRole('button', { name: 'Add recipient' }))
    expect(screen.queryByRole('combobox', { name: 'Who is this for?' })).not.toBeInTheDocument()

    const add = screen.getByRole('button', { name: 'Add' })
    expect(add).toBeDisabled()

    await user.type(screen.getByLabelText('Name'), 'Carol')
    await user.click(add)

    await waitFor(() =>
      expect(onCreateRecipient).toHaveBeenCalledWith({ name: 'Carol', member_id: null }),
    )
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

  it('edits an external recipient, storing no member', async () => {
    const user = userEvent.setup()
    const onUpdateRecipient = vi.fn()
    renderManagement({ recipients: [alice], members: [will], onUpdateRecipient })

    await user.click(screen.getByRole('button', { name: 'Edit Alice' }))
    const name = screen.getByLabelText('Name')
    expect(name).toHaveValue('Alice')
    await user.clear(name)
    await user.type(name, 'Alicia')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(onUpdateRecipient).toHaveBeenCalledWith('r1', { name: 'Alicia', member_id: null }),
    )
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
    const form = screen.getByRole('button', { name: 'Add' }).closest('form') as HTMLElement
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
