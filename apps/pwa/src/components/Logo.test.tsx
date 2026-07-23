import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { Logo } from './Logo'

describe('Logo', () => {
  it('renders the lockup with the "nest" wordmark by default', () => {
    render(<Logo />)

    const logo = screen.getByRole('img', { name: 'nest' })
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveTextContent('nest')
  })

  it('renders the mark alone with no wordmark text', () => {
    render(<Logo variant="mark" size={48} />)

    const logo = screen.getByRole('img', { name: 'nest' })
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveTextContent('')
  })

  it('applies a supplied class name', () => {
    render(<Logo className="brand-hero" />)

    expect(screen.getByRole('img', { name: 'nest' })).toHaveClass('brand-hero')
  })
})
