import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Household } from '../hooks/useHousehold'
import { render, screen } from '../test/render'
import { HouseholdSection } from './HouseholdSection'

const hooks = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: hooks.signOut } } }))

const household = {
  id: 'h1',
  name: 'The Sawyers',
  invite_code: 'abcd1234',
  invite_code_expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
} as unknown as Household

function renderSection(overrides: Partial<Parameters<typeof HouseholdSection>[0]> = {}) {
  const session = { user: { id: 'u1', email: 'will@example.com' } } as unknown as Session
  return render(
    <HouseholdSection
      household={household}
      session={session}
      onCreateInviteCode={vi.fn()}
      onRevokeInviteCode={vi.fn()}
      {...overrides}
    />,
  )
}

describe('HouseholdSection', () => {
  it('renders the household name and signed-in email', () => {
    renderSection()

    expect(screen.getByRole('heading', { name: 'The Sawyers' })).toBeInTheDocument()
    expect(screen.getByText(/will@example\.com/)).toBeInTheDocument()
  })

  it('defaults the email to an empty string when absent', () => {
    const session = { user: { id: 'u1' } } as unknown as Session
    renderSection({ session })

    expect(screen.getByText(/Signed in as/)).toBeInTheDocument()
  })

  it('signs out through supabase', () => {
    renderSection()

    screen.getByRole('button', { name: /sign out/i }).click()

    expect(hooks.signOut).toHaveBeenCalledOnce()
  })

  it('wires the invite code and callbacks through to the screen', () => {
    const onCreateInviteCode = vi.fn()
    const onRevokeInviteCode = vi.fn()
    renderSection({ onCreateInviteCode, onRevokeInviteCode })

    expect(screen.getByText('abcd1234')).toBeInTheDocument()

    screen.getByRole('button', { name: /regenerate/i }).click()
    expect(onCreateInviteCode).toHaveBeenCalledOnce()

    screen.getByRole('button', { name: /revoke/i }).click()
    expect(onRevokeInviteCode).toHaveBeenCalledOnce()
  })
})
