import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeInflow, makeMember } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { InflowScreen } from './InflowScreen'

const members = [makeMember({ id: 'm1', name: 'Will', user_id: 'u1' })]

function renderScreen(overrides: Partial<Parameters<typeof InflowScreen>[0]> = {}) {
  return render(
    <InflowScreen
      members={members}
      inflows={[]}
      onCreateInflow={vi.fn()}
      onUpdateInflow={vi.fn()}
      onDeleteInflow={vi.fn()}
      {...overrides}
    />,
  )
}

describe('InflowScreen', () => {
  it('renders the heading and the inflow list', () => {
    renderScreen()

    expect(screen.getByRole('heading', { name: /inflows/i })).toBeInTheDocument()
    expect(screen.getByText(/no inflows yet/i)).toBeInTheDocument()
  })

  it('deletes an inflow through the list', async () => {
    const user = userEvent.setup()
    const onDeleteInflow = vi.fn().mockResolvedValue(undefined)
    renderScreen({ inflows: [makeInflow({ id: 'i1', name: 'Day job' })], onDeleteInflow })

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    expect(onDeleteInflow).toHaveBeenCalledWith('i1')
  })
})
