import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CreatedShare, ShareGrantRow } from '../hooks/useShareGrant'
import { render, screen } from '../test/render'
import { EofyShareControl } from './EofyShareControl'

function renderControl(overrides: Partial<Parameters<typeof EofyShareControl>[0]> = {}) {
  return render(
    <EofyShareControl
      status={null}
      financialYear={2027}
      availableFinancialYears={[2027, 2026]}
      onCreate={vi.fn().mockResolvedValue({
        token: 't'.repeat(64),
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        emailSent: true,
      } satisfies CreatedShare)}
      onRevoke={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  )
}

const activeStatus: ShareGrantRow = {
  household_id: 'h1',
  financial_year: 2027,
  recipient_email: 'agent@example.com',
  expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  created_at: new Date().toISOString(),
}

describe('EofyShareControl', () => {
  it('offers to send a share when none is active', () => {
    renderControl()
    expect(screen.getByLabelText(/tax agent's email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    expect(screen.queryByText(/^active/i)).not.toBeInTheDocument()
  })

  it('disables Send until an email is entered', async () => {
    const user = userEvent.setup()
    renderControl()
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton).toBeDisabled()

    await user.type(screen.getByLabelText(/tax agent's email/i), 'agent@example.com')
    expect(sendButton).toBeEnabled()
  })

  it('creates a share with the entered email and the default financial year', async () => {
    const onCreate = vi.fn().mockResolvedValue({
      token: 't'.repeat(64),
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      emailSent: true,
    } satisfies CreatedShare)
    const user = userEvent.setup()
    renderControl({ onCreate, financialYear: 2027 })

    await user.type(screen.getByLabelText(/tax agent's email/i), 'agent@example.com')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(onCreate).toHaveBeenCalledWith(2027, 'agent@example.com')
  })

  it('shows the copy-link row with the freshly minted token right after creating', async () => {
    const user = userEvent.setup()
    // status starts null (no share yet), matching the moment before a create.
    renderControl({ status: null })
    await user.type(screen.getByLabelText(/tax agent's email/i), 'agent@example.com')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByRole('button', { name: /copy link/i })).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`/share/eofy/${'t'.repeat(64)}`))).toBeInTheDocument()
  })

  it('shows the active share summary without a copy-link row when nothing was just created', () => {
    // status reflects an existing share (e.g. loaded on mount), but this
    // component instance never called onCreate, so it holds no token to copy.
    renderControl({ status: activeStatus })
    expect(screen.getByText(/^active/i)).toBeInTheDocument()
    expect(screen.getByText(/agent@example\.com/)).toBeInTheDocument()
    expect(screen.getByText(/FY2027/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument()
  })

  it('describes a share lapsing within a day', () => {
    renderControl({
      status: { ...activeStatus, expires_at: new Date(Date.now() + 3 * 3_600_000).toISOString() },
    })
    expect(screen.getByText(/Expires within a day/)).toBeInTheDocument()
  })

  it('invokes onRevoke from the revoke button', async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderControl({ status: activeStatus, onRevoke })

    await user.click(screen.getByRole('button', { name: /revoke/i }))

    expect(onRevoke).toHaveBeenCalledOnce()
  })
})
