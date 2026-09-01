import { describe, expect, it, vi } from 'vitest'
import type { Member } from '../hooks/useMembers'
import { fireEvent, render, screen, within } from '../test/render'
import { DocumentIntakeTokenCard } from './DocumentIntakeTokenCard'

const members: Member[] = [
  { id: 'm1', name: 'Will', user_id: 'u1' } as Member,
  { id: 'm2', name: 'Sam', user_id: 'u2' } as Member,
]

function renderCard(overrides: Partial<Parameters<typeof DocumentIntakeTokenCard>[0]> = {}) {
  return render(
    <DocumentIntakeTokenCard
      currentUserId="u1"
      members={members}
      statuses={[]}
      busy={false}
      onCreate={vi.fn()}
      onRevoke={vi.fn()}
      {...overrides}
    />,
  )
}

const card = () => screen.getByText('Document intake').closest('.mantine-Card-root') as HTMLElement

describe('DocumentIntakeTokenCard', () => {
  it('always shows the endpoint, and offers to generate a token when none exists', () => {
    renderCard()

    expect(screen.getByText(/\/functions\/v1\/document-intake/)).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: /generate token/i })).toBeInTheDocument()
  })

  it('shows the signed-in member’s own active status with regenerate and revoke', () => {
    renderCard({ statuses: [{ member_id: 'm1', created_at: '2027-01-01T00:00:00Z' }] })

    expect(within(card()).getByText(/active since/i)).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: /regenerate/i })).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: /revoke/i })).toBeInTheDocument()
  })

  it('lists a co-member’s status read-only, without controls on their row', () => {
    renderCard({ statuses: [{ member_id: 'm2', created_at: '2027-01-01T00:00:00Z' }] })

    const samRow = screen.getByText('Sam').closest('div')!
    expect(within(samRow).getByText('Connected')).toBeInTheDocument()
    // My own row (m1) has no status yet, so the primary action is "Generate token".
    expect(within(card()).getByRole('button', { name: /generate token/i })).toBeInTheDocument()
  })

  it('shows a not-connected co-member as such', () => {
    renderCard()
    const samRow = screen.getByText('Sam').closest('div')!
    expect(within(samRow).getByText('Not connected')).toBeInTheDocument()
  })

  it('mints a token and shows it once, with a copy button', async () => {
    const onCreate = vi
      .fn()
      .mockResolvedValue({ token: 'a'.repeat(64), createdAt: '2027-01-01T00:00:00Z' })
    renderCard({ onCreate })

    fireEvent.click(within(card()).getByRole('button', { name: /generate token/i }))
    await screen.findByText('a'.repeat(64))

    expect(onCreate).toHaveBeenCalledOnce()
    expect(screen.getByText(/paste this into your shortcut/i)).toBeInTheDocument()
  })

  it('revoking clears a freshly shown token', async () => {
    const onCreate = vi
      .fn()
      .mockResolvedValue({ token: 'a'.repeat(64), createdAt: '2027-01-01T00:00:00Z' })
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    renderCard({ onCreate, onRevoke })

    fireEvent.click(within(card()).getByRole('button', { name: /generate token/i }))
    await screen.findByText('a'.repeat(64))

    fireEvent.click(within(card()).getByRole('button', { name: /revoke/i }))
    await screen.findByRole('button', { name: /generate token/i })
    expect(onRevoke).toHaveBeenCalledOnce()
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument()
  })
})
