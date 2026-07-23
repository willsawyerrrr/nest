import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeTemporaryItem } from '../test/fixtures'
import { render, screen, setWideViewport, waitFor, within } from '../test/render'
import { TemporaryItemList } from './TemporaryItemList'

const items = [
  makeTemporaryItem(),
  makeTemporaryItem({
    id: 't2',
    name: 'Old laptop fund',
    contribution_cents: 5000,
    target_date: '2020-01-01',
  }),
]

const now = new Date('2027-01-01T00:00:00')

describe('TemporaryItemList', () => {
  it('shows each item with its fortnightly contribution and target date', () => {
    render(
      <TemporaryItemList
        items={items}
        now={now}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const holiday = screen.getByText('Holiday').closest('.mantine-Card-root') as HTMLElement
    expect(within(holiday).getByText('$120.00')).toBeInTheDocument()
    expect(within(holiday).getByText(/3 Aug 2027/)).toBeInTheDocument()
  })

  it('marks items active or expired against the reference date', () => {
    render(
      <TemporaryItemList
        items={items}
        now={now}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const holiday = screen.getByText('Holiday').closest('.mantine-Card-root') as HTMLElement
    const laptop = screen.getByText('Old laptop fund').closest('.mantine-Card-root') as HTMLElement
    expect(within(holiday).getByText('Active')).toBeInTheDocument()
    expect(within(laptop).getByText('Expired')).toBeInTheDocument()
  })

  it('shows the fortnightly subtotal of only the active contributions', () => {
    render(
      <TemporaryItemList
        items={items}
        now={now}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    // Only Holiday ($120.00) is active at the reference date; the expired laptop fund is excluded.
    expect(screen.getByLabelText('Temporary fortnightly subtotal')).toHaveTextContent(
      '$120.00 / fn',
    )
  })

  it('shows an empty hint when there are no items', () => {
    render(
      <TemporaryItemList items={[]} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getByText(/no temporary lines yet/i)).toBeInTheDocument()
  })

  it('edits an item in place', async () => {
    const user = userEvent.setup()
    render(
      <TemporaryItemList
        items={items}
        now={now}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const holiday = screen.getByText('Holiday').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(holiday).getByRole('button', { name: /edit/i }))

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toHaveValue('Holiday')
  })

  it('saves an edited item through the caller', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(
      <TemporaryItemList
        items={items}
        now={now}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    )
    const holiday = screen.getByText('Holiday').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(holiday).getByRole('button', { name: /edit/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('t1', expect.objectContaining({})))
  })

  it('confirms before deleting an item', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(
      <TemporaryItemList
        items={items}
        now={now}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={onDelete}
      />,
    )
    const holiday = screen.getByText('Holiday').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(holiday).getByRole('button', { name: /delete/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('t1')
  })

  it('adds a new item through the caller', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <TemporaryItemList items={[]} onCreate={onCreate} onUpdate={vi.fn()} onDelete={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: /add temporary line/i }))
    await user.type(screen.getByLabelText(/name/i), 'New couch')
    await user.type(screen.getByLabelText(/contribution/i), '75')
    await user.click(screen.getByRole('button', { name: /add item/i }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New couch', contribution_cents: 7500 }),
      ),
    )
  })

  describe('on desktop', () => {
    it('renders each item as a dense row with its active/expired flag', () => {
      setWideViewport()
      render(
        <TemporaryItemList
          items={items}
          now={now}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />,
      )

      // No bordered card wraps a row.
      expect(screen.getByText('Holiday').closest('.mantine-Card-root')).toBeNull()
      expect(screen.getByText('$120.00')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
      expect(screen.getByText('Expired')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(2)
    })
  })
})
