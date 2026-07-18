import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SignInScreen } from './SignInScreen'

describe('SignInScreen', () => {
  it('invokes onSignIn when the Google button is clicked', () => {
    const onSignIn = vi.fn()
    render(<SignInScreen onSignIn={onSignIn} />)

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))

    expect(onSignIn).toHaveBeenCalledOnce()
  })
})
