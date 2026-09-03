import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeGoal } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { GoalScreen } from './GoalScreen'

const noop = vi.fn()

function renderScreen(overrides: Partial<Parameters<typeof GoalScreen>[0]> = {}) {
  return render(
    <GoalScreen
      goals={[]}
      lines={[]}
      savers={[]}
      onCreateGoal={vi.fn()}
      onUpdateGoal={vi.fn()}
      onDeleteGoal={vi.fn()}
      onRefresh={noop}
      refreshing={false}
      refreshError={null}
      {...overrides}
    />,
  )
}

describe('GoalScreen refresh', () => {
  it('calls onRefresh when the button is clicked', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    renderScreen({ onRefresh })

    await user.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('shows a busy state while refreshing', () => {
    renderScreen({ refreshing: true })
    expect(screen.getByRole('button', { name: /refresh/i })).toHaveAttribute('data-loading', 'true')
  })

  it('renders a refresh error when one is present', () => {
    renderScreen({ refreshError: 'Could not refresh balances. Try again.' })
    expect(screen.getByText(/could not refresh balances/i)).toBeInTheDocument()
  })

  it('passes a real goal and line baseline through to the list when given', () => {
    renderScreen({
      goals: [makeGoal({ id: 'g1', name: 'Trip', target_amount_cents: 2_000_000 })],
      baselineGoals: [makeGoal({ id: 'g1', name: 'Trip', target_amount_cents: 1_000_000 })],
      baselineLines: [],
    })
    // The goal still renders; the baseline props are threaded to GoalList.
    expect(screen.getByText('Trip')).toBeInTheDocument()
  })

  it('opens a prefilled add form for a promoted wishlist item and clears it on save', async () => {
    const user = userEvent.setup()
    const onCreateGoal = vi.fn().mockResolvedValue(undefined)
    const onPromoteConsumed = vi.fn()
    renderScreen({
      promoteDraft: { name: 'Espresso machine', amountCents: 1_200_00 },
      onCreateGoal,
      onPromoteConsumed,
    })

    expect(screen.getByText(/new goal from your wishlist item/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/name/i)).toHaveValue('Espresso machine')

    await user.click(screen.getAllByRole('button', { name: /add goal/i })[0]!)
    await waitFor(() =>
      expect(onCreateGoal).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Espresso machine', target_amount_cents: 1_200_00 }),
      ),
    )
    expect(onPromoteConsumed).toHaveBeenCalledOnce()
  })

  it('clears a promoted wishlist draft when its form is cancelled', async () => {
    const user = userEvent.setup()
    const onPromoteConsumed = vi.fn()
    renderScreen({
      promoteDraft: { name: 'New couch', amountCents: 3_500_00 },
      onPromoteConsumed,
    })

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onPromoteConsumed).toHaveBeenCalledOnce()
  })

  it('deletes a goal through the list', async () => {
    const user = userEvent.setup()
    const onDeleteGoal = vi.fn().mockResolvedValue(undefined)
    renderScreen({ goals: [makeGoal({ id: 'g1', name: 'Car' })], onDeleteGoal })

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    expect(onDeleteGoal).toHaveBeenCalledWith('g1')
  })
})
