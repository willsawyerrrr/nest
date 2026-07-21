import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeTemporaryItem } from '../test/fixtures'
import { render, screen, within } from '../test/render'
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
})
