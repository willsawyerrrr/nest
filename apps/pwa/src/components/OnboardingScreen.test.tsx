import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/render'
import { OnboardingScreen } from './OnboardingScreen'

describe('OnboardingScreen', () => {
  it('submits the household and member names when creating', async () => {
    const onCreate = vi.fn()
    render(<OnboardingScreen onCreate={onCreate} onJoin={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'The Sawyers' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Will' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create household/i }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('The Sawyers', 'Will'))
  })

  it('submits the invite code and member name when joining', async () => {
    const onJoin = vi.fn()
    render(<OnboardingScreen onCreate={vi.fn()} onJoin={onJoin} />)

    fireEvent.click(screen.getByRole('radio', { name: /join/i }))
    fireEvent.change(screen.getByLabelText(/invite code/i), {
      target: { value: 'abcd1234' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Sam' },
    })
    fireEvent.click(screen.getByRole('button', { name: /join household/i }))

    await waitFor(() => expect(onJoin).toHaveBeenCalledWith('abcd1234', 'Sam'))
  })

  it('disables the button until both fields are filled', () => {
    render(<OnboardingScreen onCreate={vi.fn()} onJoin={vi.fn()} />)

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
    render(<OnboardingScreen onCreate={onCreate} onJoin={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/household name/i), {
      target: { value: 'The Sawyers' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Will' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create household/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('ignores a submit while required fields are empty', () => {
    const onCreate = vi.fn()
    const { container } = render(<OnboardingScreen onCreate={onCreate} onJoin={vi.fn()} />)

    fireEvent.submit(container.querySelector('form')!)

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows an error when joining fails', async () => {
    const onJoin = vi.fn().mockRejectedValue(new Error('boom'))
    render(<OnboardingScreen onCreate={vi.fn()} onJoin={onJoin} />)

    fireEvent.click(screen.getByRole('radio', { name: /join/i }))
    fireEvent.change(screen.getByLabelText(/invite code/i), {
      target: { value: 'abcd1234' },
    })
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Sam' },
    })
    fireEvent.click(screen.getByRole('button', { name: /join household/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
