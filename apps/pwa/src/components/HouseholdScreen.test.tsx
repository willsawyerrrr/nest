import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '../test/render'
import { HouseholdScreen } from './HouseholdScreen'

function renderHousehold(overrides: Partial<Parameters<typeof HouseholdScreen>[0]> = {}) {
  return render(
    <HouseholdScreen
      householdName="The Sawyers"
      email="will@example.com"
      onSignOut={vi.fn()}
      inviteCode={null}
      inviteCodeExpiresAt={null}
      onCreateInviteCode={vi.fn()}
      onRevokeInviteCode={vi.fn()}
      {...overrides}
    />,
  )
}

const activeCode = {
  inviteCode: 'abcd1234',
  inviteCodeExpiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
}

describe('HouseholdScreen', () => {
  it('renders the page title, household name, and signed-in email', () => {
    renderHousehold()

    expect(screen.getByRole('heading', { name: 'Household' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The Sawyers' })).toBeInTheDocument()
    expect(screen.getByText(/will@example\.com/)).toBeInTheDocument()
  })

  it('invokes onSignOut when the button is clicked', () => {
    const onSignOut = vi.fn()
    renderHousehold({ onSignOut })

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('offers to create a code and shows none when there is no active code', () => {
    renderHousehold()

    expect(screen.getByRole('button', { name: /create invite code/i })).toBeInTheDocument()
    expect(screen.queryByText('abcd1234')).not.toBeInTheDocument()
    expect(screen.queryByText(/Invite code:/)).not.toBeInTheDocument()
  })

  it('treats an expired code as no active code', () => {
    renderHousehold({
      inviteCode: 'abcd1234',
      inviteCodeExpiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    })

    expect(screen.getByRole('button', { name: /create invite code/i })).toBeInTheDocument()
    expect(screen.queryByText('abcd1234')).not.toBeInTheDocument()
  })

  it('invokes onCreateInviteCode from the create button', () => {
    const onCreateInviteCode = vi.fn()
    renderHousehold({ onCreateInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /create invite code/i }))

    expect(onCreateInviteCode).toHaveBeenCalledOnce()
  })

  it('shows an active code with copy, expiry, regenerate, and revoke', () => {
    renderHousehold(activeCode)

    expect(screen.getByText('abcd1234')).toBeInTheDocument()
    const card = screen.getByText('abcd1234').closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /regenerate/i })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /revoke/i })).toBeInTheDocument()
    expect(screen.getByText(/Expires in \d+ days/)).toBeInTheDocument()
    expect(screen.getByText(/Share this code with others/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create invite code/i })).not.toBeInTheDocument()
  })

  it('describes a code lapsing within a day', () => {
    renderHousehold({
      inviteCode: 'abcd1234',
      inviteCodeExpiresAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    })

    expect(screen.getByText(/Expires within a day/)).toBeInTheDocument()
  })

  it('invokes onCreateInviteCode from the regenerate button', () => {
    const onCreateInviteCode = vi.fn()
    renderHousehold({ ...activeCode, onCreateInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(onCreateInviteCode).toHaveBeenCalledOnce()
  })

  it('invokes onRevokeInviteCode from the revoke button', () => {
    const onRevokeInviteCode = vi.fn()
    renderHousehold({ ...activeCode, onRevokeInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))

    expect(onRevokeInviteCode).toHaveBeenCalledOnce()
  })
})
