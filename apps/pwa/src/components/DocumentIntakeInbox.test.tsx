import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentIntakeRow } from '../hooks/useDocumentIntake'
import { render, screen } from '../test/render'
import { DocumentIntakeInbox } from './DocumentIntakeInbox'

function makeItem(overrides: Partial<DocumentIntakeRow> = {}): DocumentIntakeRow {
  return {
    id: 'i1',
    household_id: 'h1',
    member_id: 'm1',
    kind: 'deduction',
    storage_path: 'h1/i1/receipt.pdf',
    original_filename: 'receipt.pdf',
    // Noon UTC, so the local time it renders as varies by test-runner timezone
    // while the calendar date it falls on does not.
    created_at: '2027-03-04T12:00:00Z',
    ...overrides,
  }
}

const memberName = vi.fn((memberId: string) => (memberId === 'm1' ? 'Will' : 'Unknown member'))

describe('DocumentIntakeInbox', () => {
  it('renders nothing when there is nothing staged', () => {
    render(
      <DocumentIntakeInbox
        items={[]}
        memberName={memberName}
        busyId={null}
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.queryByText('Shared to Nest')).not.toBeInTheDocument()
  })

  it('lists each item’s filename, member, and upload time', () => {
    render(
      <DocumentIntakeInbox
        items={[makeItem()]}
        memberName={memberName}
        busyId={null}
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument()
    // The local time depends on the runner's timezone; the format around it does not.
    expect(screen.getByText(/Will/)).toHaveTextContent(/^Will · 4 Mar, \d{1,2}:\d{2}\s*[ap]m$/i)
  })

  it('falls back to a generic name for a file with none', () => {
    render(
      <DocumentIntakeInbox
        items={[makeItem({ original_filename: null })]}
        memberName={memberName}
        busyId={null}
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('Untitled document')).toBeInTheDocument()
  })

  it('calls onReview with the clicked item', async () => {
    const user = userEvent.setup()
    const item = makeItem()
    const onReview = vi.fn()
    render(
      <DocumentIntakeInbox
        items={[item]}
        memberName={memberName}
        busyId={null}
        onReview={onReview}
        onDismiss={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /review/i }))

    expect(onReview).toHaveBeenCalledWith(item)
  })

  it('calls onDismiss with the clicked item', async () => {
    const user = userEvent.setup()
    const item = makeItem()
    const onDismiss = vi.fn()
    render(
      <DocumentIntakeInbox
        items={[item]}
        memberName={memberName}
        busyId={null}
        onReview={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(onDismiss).toHaveBeenCalledWith(item)
  })

  it('shows only the busy item as loading, leaving the others’ controls enabled', () => {
    render(
      <DocumentIntakeInbox
        items={[makeItem({ id: 'i1' }), makeItem({ id: 'i2', original_filename: 'other.pdf' })]}
        memberName={memberName}
        busyId="i1"
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    const [review1, review2] = screen.getAllByRole('button', { name: /review/i })
    const [dismiss1, dismiss2] = screen.getAllByRole('button', { name: /dismiss/i })

    expect(review1).toHaveAttribute('data-loading', 'true')
    expect(dismiss1).toBeDisabled()
    expect(review2).not.toHaveAttribute('data-loading', 'true')
    expect(dismiss2).not.toBeDisabled()
  })
})
