import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, within } from '../test/render'
import { describe, expect, it, vi } from 'vitest'
import { HomeScreen } from './HomeScreen'
import type { Member } from '../hooks/useMembers'

const members: Member[] = [
  {
    id: 'm1',
    household_id: 'h1',
    name: 'Will',
    email: null,
    user_id: 'u1',
    created_at: '',
    updated_at: '',
  },
  {
    id: 'm2',
    household_id: 'h1',
    name: 'Sam',
    email: null,
    user_id: 'u2',
    created_at: '',
    updated_at: '',
  },
]

function renderHome(overrides: Partial<Parameters<typeof HomeScreen>[0]> = {}) {
  return render(
    <HomeScreen
      householdName="The Sawyers"
      inviteCode="abcd1234"
      email="will@example.com"
      members={members}
      taxProfiles={[]}
      financialYear={2027}
      onUpsertTaxProfile={vi.fn()}
      onSignOut={vi.fn()}
      {...overrides}
    />,
  )
}

describe('HomeScreen', () => {
  it('renders the household name, member email, and invite code', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: 'The Sawyers' })).toBeInTheDocument()
    expect(screen.getByText(/will@example\.com/)).toBeInTheDocument()
    expect(screen.getByText('abcd1234')).toBeInTheDocument()
  })

  it('invokes onSignOut when the button is clicked', () => {
    const onSignOut = vi.fn()
    renderHome({ onSignOut })

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('collapses tax profiles into a per-member row, revealing the form on edit', async () => {
    const user = userEvent.setup()
    renderHome()

    expect(screen.getByRole('heading', { name: /Tax profiles \(FY2027\)/ })).toBeInTheDocument()
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
