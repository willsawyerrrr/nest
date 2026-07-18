import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomeScreen } from './HomeScreen'

describe('HomeScreen', () => {
  it('renders the household name, member email, and invite code', () => {
    render(
      <HomeScreen
        householdName="The Sawyers"
        inviteCode="abcd1234"
        email="will@example.com"
        onSignOut={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'The Sawyers' })).toBeInTheDocument()
    expect(screen.getByText(/will@example\.com/)).toBeInTheDocument()
    expect(screen.getByText('abcd1234')).toBeInTheDocument()
  })

  it('invokes onSignOut when the button is clicked', () => {
    const onSignOut = vi.fn()
    render(
      <HomeScreen
        householdName="The Sawyers"
        inviteCode="abcd1234"
        email="will@example.com"
        onSignOut={onSignOut}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
