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
      inviteCode={null}
      inviteCodeExpiresAt={null}
      email="will@example.com"
      members={members}
      taxProfiles={[]}
      financialYear={2027}
      onUpsertTaxProfile={vi.fn()}
      onCreateInviteCode={vi.fn()}
      onRevokeInviteCode={vi.fn()}
      onSignOut={vi.fn()}
      {...overrides}
    />,
  )
}

const activeCode = {
  inviteCode: 'abcd1234',
  inviteCodeExpiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
}

describe('HomeScreen', () => {
  it('renders the household name and member email', () => {
    renderHome()

    expect(screen.getByRole('heading', { name: 'The Sawyers' })).toBeInTheDocument()
    expect(screen.getByText(/will@example\.com/)).toBeInTheDocument()
  })

  it('renders tax profiles above the invite section', () => {
    renderHome()

    const taxHeading = screen.getByRole('heading', { name: /Tax profiles \(FY2027\)/ })
    const inviteHeading = screen.getByRole('heading', { name: /Invite someone/ })
    expect(
      taxHeading.compareDocumentPosition(inviteHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('offers to create a code and shows none when there is no active code', () => {
    renderHome()

    expect(screen.getByRole('button', { name: /create invite code/i })).toBeInTheDocument()
    expect(screen.queryByText('abcd1234')).not.toBeInTheDocument()
    expect(screen.queryByText(/Invite code:/)).not.toBeInTheDocument()
  })

  it('treats an expired code as no active code', () => {
    renderHome({
      inviteCode: 'abcd1234',
      inviteCodeExpiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    })

    expect(screen.getByRole('button', { name: /create invite code/i })).toBeInTheDocument()
    expect(screen.queryByText('abcd1234')).not.toBeInTheDocument()
  })

  it('invokes onCreateInviteCode from the create button', () => {
    const onCreateInviteCode = vi.fn()
    renderHome({ onCreateInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /create invite code/i }))

    expect(onCreateInviteCode).toHaveBeenCalledOnce()
  })

  it('shows an active code with copy, expiry, regenerate, and revoke', () => {
    renderHome(activeCode)

    expect(screen.getByText('abcd1234')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
    expect(screen.getByText(/Expires in \d+ days/)).toBeInTheDocument()
    expect(screen.getByText(/Share this code with others/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create invite code/i })).not.toBeInTheDocument()
  })

  it('invokes onRevokeInviteCode from the revoke button', () => {
    const onRevokeInviteCode = vi.fn()
    renderHome({ ...activeCode, onRevokeInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))

    expect(onRevokeInviteCode).toHaveBeenCalledOnce()
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
