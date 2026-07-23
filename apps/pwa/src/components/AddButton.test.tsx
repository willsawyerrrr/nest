import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { AddButton } from './AddButton'

describe('AddButton', () => {
  it('renders its label', () => {
    render(<AddButton label="Add deduction" />)
    expect(screen.getByRole('button', { name: 'Add deduction' })).toBeInTheDocument()
  })

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn()
    render(<AddButton label="Add line" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
