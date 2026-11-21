import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { TransactionReviewCard } from './TransactionReviewCard'

describe('TransactionReviewCard', () => {
  it('names how many transactions await review and links to the review screen', () => {
    render(
      <MemoryRouter>
        <TransactionReviewCard count={3} />
      </MemoryRouter>,
    )
    expect(screen.getByText('3 to review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/transactions/review',
    )
  })

  it('names a single transaction in the singular', () => {
    render(
      <MemoryRouter>
        <TransactionReviewCard count={1} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/your new Up transaction\./)).toBeInTheDocument()
  })

  it('renders nothing when none await review', () => {
    render(<TransactionReviewCard count={0} />)
    expect(screen.queryByText(/to review/)).not.toBeInTheDocument()
  })
})
