import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { ActualSpendBar } from './ActualSpendBar'

const period = { periodStart: '2026-11-12', periodEnd: '2026-11-25' }

function renderBar(overrides: Partial<Parameters<typeof ActualSpendBar>[0]> = {}) {
  const props = {
    period,
    isCurrent: true,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    includePending: false,
    onIncludePendingChange: vi.fn(),
    unbudgetedCents: 42_00,
    onEditCategoryGroups: vi.fn(),
    ...overrides,
  }
  render(<ActualSpendBar {...props} />)
  return props
}

describe('ActualSpendBar', () => {
  it('names the fortnight and the spend in no group', () => {
    renderBar()
    expect(screen.getByText('Spent this fortnight')).toBeInTheDocument()
    expect(screen.getByLabelText('Reconciled fortnight')).toHaveTextContent(
      '12 Nov 2026 – 25 Nov 2026',
    )
    expect(screen.getByLabelText('Spend in no group')).toHaveTextContent('$42.00 in no group')
  })

  it('hides a nil or loading unbudgeted figure', () => {
    renderBar({ unbudgetedCents: 0 })
    expect(screen.queryByLabelText('Spend in no group')).not.toBeInTheDocument()
  })

  it('steps back, and forward only from an earlier fortnight', async () => {
    const user = userEvent.setup()
    const props = renderBar()
    expect(screen.getByRole('button', { name: 'Next fortnight' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous fortnight' }))
    expect(props.onPrevious).toHaveBeenCalled()
  })

  it('reads an earlier fortnight in the past tense and steps forward', async () => {
    const user = userEvent.setup()
    const props = renderBar({ isCurrent: false })
    expect(screen.getByText('Spent that fortnight')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next fortnight' }))
    expect(props.onNext).toHaveBeenCalled()
  })

  it('toggles pending spend', async () => {
    const user = userEvent.setup()
    const props = renderBar()
    await user.click(screen.getByRole('switch', { name: 'Include pending' }))
    expect(props.onIncludePendingChange).toHaveBeenCalledWith(true)
  })

  it('opens the category groups', async () => {
    const user = userEvent.setup()
    const props = renderBar()
    await user.click(screen.getByRole('button', { name: 'Category groups' }))
    expect(props.onEditCategoryGroups).toHaveBeenCalled()
  })
})
