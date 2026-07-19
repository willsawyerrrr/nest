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
    up_connected_at: null,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'm2',
    household_id: 'h1',
    name: 'Sam',
    email: null,
    user_id: 'u2',
    up_connected_at: null,
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
      currentUserId="u1"
      members={members}
      taxProfiles={[]}
      financialYear={2027}
      onUpsertTaxProfile={vi.fn()}
      onCreateInviteCode={vi.fn()}
      onRevokeInviteCode={vi.fn()}
      onConnectUp={vi.fn()}
      onDisconnectUp={vi.fn()}
      upBusy={false}
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

    const taxSection = screen.getByRole('heading', { name: /Tax profiles \(FY2027\)/ })
      .parentElement as HTMLElement
    expect(within(taxSection).getByText('Will')).toBeInTheDocument()
    expect(within(taxSection).getByText('Sam')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(members.length)
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()

    const will = within(taxSection).getByText('Will').closest('.mantine-Card-root') as HTMLElement
    await user.click(within(will).getByRole('button', { name: /edit/i }))

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /residency/i })).toBeInTheDocument()
  })

  it('offers a token field and connects the signed-in member', async () => {
    const user = userEvent.setup()
    const onConnectUp = vi.fn()
    renderHome({ onConnectUp })

    expect(screen.getByRole('heading', { name: /Connect Up/ })).toBeInTheDocument()
    const field = screen.getByLabelText(/Up personal access token/i)
    await user.type(field, 'up:yeah:secret')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(onConnectUp).toHaveBeenCalledWith('up:yeah:secret')
  })

  it('shows Connected and a disconnect action when the signed-in member is connected', () => {
    const onDisconnectUp = vi.fn()
    const connectedMembers = members.map((member) =>
      member.user_id === 'u1' ? { ...member, up_connected_at: new Date().toISOString() } : member,
    )
    renderHome({ members: connectedMembers, onDisconnectUp })

    const card = screen
      .getByRole('heading', { name: /Connect Up/ })
      .closest('.mantine-Card-root') as HTMLElement
    // The status badge, plus Will's own row in the per-member list.
    expect(within(card).getAllByText('Connected')).toHaveLength(2)
    expect(screen.queryByLabelText(/Up personal access token/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(onDisconnectUp).toHaveBeenCalledOnce()
  })

  it('lists each member connection status', () => {
    const connectedMembers = members.map((member) =>
      member.user_id === 'u2' ? { ...member, up_connected_at: new Date().toISOString() } : member,
    )
    renderHome({ members: connectedMembers })

    const card = screen
      .getByRole('heading', { name: /Connect Up/ })
      .closest('.mantine-Card-root') as HTMLElement
    // Will (u1) not connected, Sam (u2) connected.
    expect(within(card).getByText('Not connected')).toBeInTheDocument()
    expect(within(card).getAllByText('Connected')).toHaveLength(1)
  })
})
