import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingScreen } from './OnboardingScreen'

describe('OnboardingScreen', () => {
  it('submits the household and member names', async () => {
    const onCreate = vi.fn()
    render(<OnboardingScreen onCreate={onCreate} />)

    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'The Sawyers' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Will' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create household/i }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('The Sawyers', 'Will'))
  })

  it('disables the button until both fields are filled', () => {
    render(<OnboardingScreen onCreate={vi.fn()} />)

    const button = screen.getByRole('button', { name: /create household/i })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'The Sawyers' },
    })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Will' },
    })
    expect(button).toBeEnabled()
  })

  it('shows an error when creation fails', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'))
    render(<OnboardingScreen onCreate={onCreate} />)

    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'The Sawyers' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Will' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create household/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
