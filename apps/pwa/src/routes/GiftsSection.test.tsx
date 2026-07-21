import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { GiftsSection } from './GiftsSection'

const hooks = vi.hoisted(() => ({
  useGifts: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useGifts', () => ({ useGifts: hooks.useGifts }))
vi.mock('../components/GiftsScreen', () => ({
  GiftsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="gifts-screen" />
  },
}))

describe('GiftsSection', () => {
  it('shows the loading screen while gifts load', () => {
    hooks.useGifts.mockReturnValue({ loading: true })
    render(<GiftsSection householdId="h1" backTo="/breakdowns" backLabel="Breakdowns" />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the gifts screen with loaded data and navigation props', () => {
    hooks.useGifts.mockReturnValue({
      loading: false,
      recipients: [],
      occasions: [],
      budgets: [],
      purchases: [],
      createRecipient: vi.fn(),
      updateRecipient: vi.fn(),
      removeRecipient: vi.fn(),
      createOccasion: vi.fn(),
      updateOccasion: vi.fn(),
      removeOccasion: vi.fn(),
      createBudget: vi.fn(),
      updateBudget: vi.fn(),
      removeBudget: vi.fn(),
      createPurchase: vi.fn(),
      updatePurchase: vi.fn(),
      removePurchase: vi.fn(),
    })
    render(<GiftsSection householdId="h1" backTo="/budget" backLabel="Budget" />)
    expect(screen.getByTestId('gifts-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ backTo: '/budget', backLabel: 'Budget' })
  })
})
