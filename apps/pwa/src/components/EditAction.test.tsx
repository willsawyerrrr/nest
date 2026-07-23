import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { EditAction } from './EditAction'

describe('EditAction', () => {
  it('renders an Edit-labelled control', () => {
    render(<EditAction />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn()
    render(<EditAction onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
