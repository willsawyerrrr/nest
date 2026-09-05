import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '../test/render'
import { PartnerScreen } from './PartnerScreen'

function renderPartner(overrides: Partial<Parameters<typeof PartnerScreen>[0]> = {}) {
  return render(
    <PartnerScreen
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

describe('PartnerScreen', () => {
  it('renders the page title', () => {
    renderPartner()

    expect(screen.getByRole('heading', { name: 'Partner' })).toBeInTheDocument()
  })

  it('offers to create a code and shows none when there is no active code', () => {
    renderPartner()

    expect(screen.getByRole('button', { name: /create invite code/i })).toBeInTheDocument()
    expect(screen.queryByText('abcd1234')).not.toBeInTheDocument()
    expect(screen.queryByText(/Invite code:/)).not.toBeInTheDocument()
  })

  it('treats an expired code as no active code', () => {
    renderPartner({
      inviteCode: 'abcd1234',
      inviteCodeExpiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    })

    expect(screen.getByRole('button', { name: /create invite code/i })).toBeInTheDocument()
    expect(screen.queryByText('abcd1234')).not.toBeInTheDocument()
  })

  it('invokes onCreateInviteCode from the create button', () => {
    const onCreateInviteCode = vi.fn()
    renderPartner({ onCreateInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /create invite code/i }))

    expect(onCreateInviteCode).toHaveBeenCalledOnce()
  })

  it('shows an active code with copy, expiry, regenerate, and revoke', () => {
    renderPartner(activeCode)

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
    renderPartner({
      inviteCode: 'abcd1234',
      inviteCodeExpiresAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    })

    expect(screen.getByText(/Expires within a day/)).toBeInTheDocument()
  })

  it('invokes onCreateInviteCode from the regenerate button', () => {
    const onCreateInviteCode = vi.fn()
    renderPartner({ ...activeCode, onCreateInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(onCreateInviteCode).toHaveBeenCalledOnce()
  })

  it('invokes onRevokeInviteCode from the revoke button', () => {
    const onRevokeInviteCode = vi.fn()
    renderPartner({ ...activeCode, onRevokeInviteCode })

    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))

    expect(onRevokeInviteCode).toHaveBeenCalledOnce()
  })
})
