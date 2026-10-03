import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine, makeMemberAllowance } from '../test/fixtures'
import { render, screen, waitFor, within } from '../test/render'
import { MemberAllowanceList } from './MemberAllowanceList'

const members = [
  { id: 'm1', name: 'Ada' },
  { id: 'm2', name: 'Bob' },
]

function renderList(overrides: Partial<Parameters<typeof MemberAllowanceList>[0]> = {}) {
  const props = {
    members,
    allowances: [],
    lines: [],
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<MemberAllowanceList {...props} />)
  return props
}

describe('MemberAllowanceList', () => {
  it('offers to set an allowance for each member without one', () => {
    renderList()
    expect(screen.getByRole('button', { name: 'Set Ada’s allowance' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set Bob’s allowance' })).toBeInTheDocument()
  })

  it('creates an allowance from the inline form', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList()

    await user.click(screen.getByRole('button', { name: 'Set Ada’s allowance' }))
    await user.type(screen.getByLabelText(/ada’s allowance/i), '200')
    await user.click(screen.getByRole('button', { name: 'Set allowance' }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ member_id: 'm1', amount_cents: 200_00 }),
      ),
    )
    // The form closes once saved.
    await waitFor(() => expect(screen.queryByLabelText(/ada’s allowance$/i)).toBeNull())
  })

  it('shows what is drawn and what is left', () => {
    renderList({
      allowances: [makeMemberAllowance()],
      lines: [
        makeBudgetLine({
          line_group: 'discretionary',
          amount_cents: 60_00,
          allowance_member_id: 'm1',
        }),
        makeBudgetLine({ line_group: 'discretionary', amount_cents: 999_00 }),
      ],
    })

    expect(screen.getByText('Ada’s allowance')).toBeInTheDocument()
    expect(screen.getByText(/drawn \$60\.00 \/ fn/i)).toBeInTheDocument()
    expect(screen.getByText('Left')).toBeInTheDocument()
    expect(screen.getByText('$140.00')).toBeInTheDocument()
    expect(screen.queryByText('Overdrawn')).toBeNull()
    expect(screen.getByRole('button', { name: 'Set Bob’s allowance' })).toBeInTheDocument()
  })

  it('flags an overdrawn allowance and says by how much', () => {
    renderList({
      allowances: [makeMemberAllowance()],
      lines: [
        makeBudgetLine({
          line_group: 'discretionary',
          amount_cents: 250_00,
          allowance_member_id: 'm1',
        }),
      ],
    })

    expect(screen.getByText('Overdrawn')).toBeInTheDocument()
    expect(screen.getByText('Overdrawn by')).toBeInTheDocument()
    expect(screen.getByText('$50.00')).toBeInTheDocument()
  })

  it('edits an allowance in place', async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderList({ allowances: [makeMemberAllowance()] })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const amount = screen.getByLabelText(/ada’s allowance/i)
    await user.clear(amount)
    await user.type(amount, '250')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        'al1',
        expect.objectContaining({ member_id: 'm1', amount_cents: 250_00 }),
      ),
    )
  })

  it('removes an allowance after confirming', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderList({ allowances: [makeMemberAllowance()] })

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/ada’s allowance/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /delete|remove/i }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('al1'))
  })

  it('cancels an open form', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Set Ada’s allowance' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Set Ada’s allowance' })).toBeInTheDocument()
  })
})
