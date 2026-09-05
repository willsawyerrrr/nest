import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../test/render'
import { AccountScreen } from './AccountScreen'

describe('AccountScreen', () => {
  it('renders the household name and signed-in email', () => {
    render(
      <AccountScreen householdName="The Sawyers" email="will@example.com" onSignOut={vi.fn()} />,
    )

    expect(screen.getByRole('heading', { name: 'The Sawyers' })).toBeInTheDocument()
    expect(screen.getByText(/will@example\.com/)).toBeInTheDocument()
  })

  it('invokes onSignOut when the button is clicked', () => {
    const onSignOut = vi.fn()
    render(
      <AccountScreen householdName="The Sawyers" email="will@example.com" onSignOut={onSignOut} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
