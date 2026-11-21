import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { TransactionReviewSection } from './TransactionReviewSection'

const hooks = vi.hoisted(() => ({
  useTransactionReview: vi.fn(),
  useAccountDirectory: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useTransactionReview', () => ({
  useTransactionReview: hooks.useTransactionReview,
}))
vi.mock('../hooks/useAccountDirectory', () => ({
  useAccountDirectory: hooks.useAccountDirectory,
}))
vi.mock('../components/TransactionReviewScreen', () => ({
  TransactionReviewScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="review-screen" />
  },
}))

const review = vi.fn()

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TransactionReviewSection />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hooks.useTransactionReview.mockReturnValue({
    loading: false,
    transactions: [],
    focused: null,
    categories: [],
    review,
  })
  hooks.useAccountDirectory.mockReturnValue({
    accounts: [{ id: 'a1', name: '💸 Spending' }],
    loading: false,
  })
})

describe('TransactionReviewSection', () => {
  it('shows the loading screen until every read lands', () => {
    hooks.useAccountDirectory.mockReturnValue({ accounts: null, loading: true })
    renderAt('/transactions/review')
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('passes the focus id through and names accounts without their emoji', () => {
    renderAt('/transactions/review?id=abc')
    expect(hooks.useTransactionReview).toHaveBeenCalledWith('abc')
    expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({
      transactions: [],
      focused: null,
      categories: [],
      accountNames: { a1: 'Spending' },
      onReview: review,
    })
  })

  it('focuses nothing without an id', () => {
    renderAt('/transactions/review')
    expect(hooks.useTransactionReview).toHaveBeenCalledWith(null)
  })

  it('treats unloaded reads as empty', () => {
    hooks.useTransactionReview.mockReturnValue({
      loading: false,
      transactions: null,
      focused: null,
      categories: null,
      review,
    })
    hooks.useAccountDirectory.mockReturnValue({ accounts: null, loading: false })
    renderAt('/transactions/review')
    expect(hooks.screenProps).toMatchObject({ transactions: [], categories: [], accountNames: {} })
  })
})
