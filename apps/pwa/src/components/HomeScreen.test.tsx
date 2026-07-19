import { fireEvent, render, screen } from '../test/render'
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

  it('renders a tax-profile form per member under a financial-year heading', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: /Tax profiles \(FY2027\)/ })).toBeInTheDocument()
    expect(screen.getByText('Will')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /save/i })).toHaveLength(members.length)
  })
})
