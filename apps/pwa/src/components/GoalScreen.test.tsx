import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '../test/render'
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
})
