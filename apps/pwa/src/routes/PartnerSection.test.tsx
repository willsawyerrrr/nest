import { describe, expect, it, vi } from 'vitest'
import type { Household } from '../hooks/useHousehold'
import { render, screen } from '../test/render'
import { PartnerSection } from './PartnerSection'

const household = {
  id: 'h1',
  invite_code: 'abcd1234',
  invite_code_expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
} as unknown as Household

describe('PartnerSection', () => {
  it('wires the invite code and callbacks through to the screen', () => {
    const onCreateInviteCode = vi.fn()
    const onRevokeInviteCode = vi.fn()
    render(
      <PartnerSection
        household={household}
        onCreateInviteCode={onCreateInviteCode}
        onRevokeInviteCode={onRevokeInviteCode}
      />,
    )

    expect(screen.getByText('abcd1234')).toBeInTheDocument()

    screen.getByRole('button', { name: /regenerate/i }).click()
    expect(onCreateInviteCode).toHaveBeenCalledOnce()

    screen.getByRole('button', { name: /revoke/i }).click()
    expect(onRevokeInviteCode).toHaveBeenCalledOnce()
  })
})
