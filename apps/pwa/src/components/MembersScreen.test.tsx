import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { render, screen, within } from '../test/render'
import { MembersScreen } from './MembersScreen'

const members = [
  makeMember({ id: 'm1', name: 'Will', user_id: 'u1' }),
  makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' }),
]

describe('MembersScreen', () => {
  it('renders the page title and the financial year', () => {
    render(
      <MembersScreen
        members={members}
        taxProfiles={[]}
        financialYear={2027}
        onUpsertTaxProfile={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Members & tax profiles' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Tax profiles \(FY2027\)/ })).toBeInTheDocument()
  })

  it('lists each member and reveals the edit form for one', async () => {
    const user = userEvent.setup()
    render(
      <MembersScreen
        members={members}
        taxProfiles={[]}
        financialYear={2027}
        onUpsertTaxProfile={vi.fn()}
      />,
    )

    expect(screen.getByText('Will')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(members.length)
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()

    const will = screen.getByText('Will').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(will).getByRole('button', { name: /edit/i }))

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /residency/i })).toBeInTheDocument()
  })
})
