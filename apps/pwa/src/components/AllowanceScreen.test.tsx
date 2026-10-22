import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine, makeMemberAllowance } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { AllowanceScreen } from './AllowanceScreen'

function renderScreen(overrides: Partial<Parameters<typeof AllowanceScreen>[0]> = {}) {
  const props = {
    memberName: 'Ada',
    allowance: makeMemberAllowance(),
    lines: [],
    goals: [],
    accounts: [],
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(
    <MemoryRouter>
      <AllowanceScreen {...props} />
    </MemoryRouter>,
  )
  return props
}

describe('AllowanceScreen', () => {
  it('lists only the items drawn from the allowance, linking back to the budget', () => {
    renderScreen({
      lines: [
        makeBudgetLine({ id: 'l1', name: 'Gym', allowance_member_id: 'm1' }),
        makeBudgetLine({ id: 'l2', name: 'Rent', allowance_member_id: null }),
      ],
    })
    expect(screen.getByRole('heading', { name: 'Ada’s allowance' })).toBeInTheDocument()
    expect(screen.getByText('Gym')).toBeInTheDocument()
    expect(screen.queryByText('Rent')).toBeNull()
    expect(screen.getByRole('link', { name: /budget/i })).toHaveAttribute('href', '/budget')
  })

  it('says when nothing is drawn yet', () => {
    renderScreen()
    expect(screen.getByText('Nothing drawn from your allowance yet.')).toBeInTheDocument()
  })

  it('adds an item drawn from the allowance by default', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderScreen()
    await user.click(screen.getByRole('button', { name: 'Add allowance item' }))
    const form = screen.getByRole('textbox', { name: /name/i }).closest('form') as HTMLElement
    await user.type(within(form).getByLabelText(/name/i), 'Coffee')
    await user.type(within(form).getByLabelText(/amount/i), '5')
    await user.click(within(form).getByRole('button', { name: /add item/i }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Coffee', allowance_member_id: 'm1' }),
      ),
    )
  })
})
