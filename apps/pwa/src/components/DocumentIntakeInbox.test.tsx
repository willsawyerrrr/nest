import { describe, expect, it, vi } from 'vitest'
import type { DocumentIntakeRow } from '../hooks/useDocumentIntake'
import { render, screen } from '../test/render'
import { DocumentIntakeInbox } from './DocumentIntakeInbox'

const item: DocumentIntakeRow = {
  id: 'i1',
  household_id: 'h1',
  member_id: 'm1',
  kind: 'payslip',
  storage_path: 'h1/i1/slip.pdf',
  original_filename: 'slip.pdf',
  created_at: '2027-01-01T00:00:00Z',
}

describe('DocumentIntakeInbox', () => {
  it('renders nothing when there are no staged items', () => {
    render(
      <DocumentIntakeInbox
        items={[]}
        memberName={() => 'Will'}
        busyId={null}
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.queryByText('Shared to Nest')).not.toBeInTheDocument()
  })

  it('shows a staged item with its filename and member, and wires Review/Dismiss', () => {
    const onReview = vi.fn()
    const onDismiss = vi.fn()
    render(
      <DocumentIntakeInbox
        items={[item]}
        memberName={(id) => (id === 'm1' ? 'Will' : 'Unknown')}
        busyId={null}
        onReview={onReview}
        onDismiss={onDismiss}
      />,
    )

    expect(screen.getByText('slip.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Will/)).toBeInTheDocument()

    screen.getByRole('button', { name: /review/i }).click()
    expect(onReview).toHaveBeenCalledWith(item)

    screen.getByRole('button', { name: /dismiss/i }).click()
    expect(onDismiss).toHaveBeenCalledWith(item)
  })

  it('shows "Untitled document" when no filename was recorded', () => {
    render(
      <DocumentIntakeInbox
        items={[{ ...item, original_filename: null }]}
        memberName={() => 'Will'}
        busyId={null}
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('Untitled document')).toBeInTheDocument()
  })

  it('shows the busy item’s Review button as loading', () => {
    render(
      <DocumentIntakeInbox
        items={[item]}
        memberName={() => 'Will'}
        busyId="i1"
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /review/i })).toHaveAttribute('data-loading', 'true')
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeDisabled()
  })
})
