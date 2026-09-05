import type { Session } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Household } from '../hooks/useHousehold'
import { render, screen } from '../test/render'
import { AccountSection } from './AccountSection'

const hooks = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: hooks.signOut } } }))

const household = { id: 'h1', name: 'The Sawyers' } as unknown as Household

describe('AccountSection', () => {
  it('renders the household name and signed-in email', () => {
    const session = { user: { id: 'u1', email: 'will@example.com' } } as unknown as Session
    render(<AccountSection household={household} session={session} />)

    expect(screen.getByRole('heading', { name: 'The Sawyers' })).toBeInTheDocument()
    expect(screen.getByText(/will@example\.com/)).toBeInTheDocument()
  })

  it('defaults the email to an empty string when absent', () => {
    const session = { user: { id: 'u1' } } as unknown as Session
    render(<AccountSection household={household} session={session} />)

    expect(screen.getByText(/Signed in as/)).toBeInTheDocument()
  })

  it('signs out through supabase', () => {
    const session = { user: { id: 'u1', email: 'will@example.com' } } as unknown as Session
    render(<AccountSection household={household} session={session} />)

    screen.getByRole('button', { name: /sign out/i }).click()

    expect(hooks.signOut).toHaveBeenCalledOnce()
  })
})
