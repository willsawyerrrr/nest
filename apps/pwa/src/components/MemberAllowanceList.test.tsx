import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeBudgetLine, makeMemberAllowance } from '../test/fixtures'
import { render, screen, waitFor } from '../test/render'
import { MemberAllowanceList } from './MemberAllowanceList'

const members = [
  { id: 'm1', name: 'Ada' },
  { id: 'm2', name: 'Bob' },
]

function renderList(overrides: Partial<Parameters<typeof MemberAllowanceList>[0]> = {}) {
  const props = {
    members,
    allowances: [makeMemberAllowance()],
    lines: [],
    onUpdate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(<MemberAllowanceList {...props} />)
  return props
}

describe('MemberAllowanceList', () => {
  it('lists each member’s allowance with no way to delete it', () => {
    renderList({
      allowances: [makeMemberAllowance(), makeMemberAllowance({ id: 'al2', member_id: 'm2' })],
    })
    expect(screen.getByText('Ada’s allowance')).toBeInTheDocument()
    expect(screen.getByText('Bob’s allowance')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: /set .*allowance/i })).toBeNull()
  })

  it('shows nothing for a member whose allowance has not loaded', () => {
    renderList({ allowances: [] })
    expect(screen.queryByText(/allowance$/i)).toBeNull()
  })

  it('shows an unset allowance as an empty bar, and as full once anything is drawn', () => {
    const { unmount } = render(
      <MemberAllowanceList
        members={members}
        allowances={[makeMemberAllowance({ amount_cents: 0 })]}
        lines={[]}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByRole('progressbar', { name: 'Ada’s allowance drawn' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    unmount()
    render(
      <MemberAllowanceList
        members={members}
        allowances={[makeMemberAllowance({ amount_cents: 0 })]}
        lines={[
          makeBudgetLine({
            line_group: 'discretionary',
            amount_cents: 10_00,
            allowance_member_id: 'm1',
          }),
        ]}
        onUpdate={vi.fn()}
      />,
    )
    expect(screen.getByRole('progressbar', { name: 'Ada’s allowance drawn' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
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
        expect.objectContaining({ amount_cents: 250_00 }),
      ),
    )
  })

  it('cancels an open form', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
})
