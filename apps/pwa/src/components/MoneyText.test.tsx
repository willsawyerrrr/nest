import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { MoneyText } from './MoneyText'

describe('MoneyText', () => {
  it('formats cents as AUD', () => {
    render(<MoneyText cents={1_234_56} />)
    expect(screen.getByText('$1,234.56')).toBeInTheDocument()
  })

  it('renders with tabular lining figures', () => {
    render(<MoneyText cents={1_00} />)
    expect(screen.getByText('$1.00').style.fontVariantNumeric).toBe('tabular-nums lining-nums')
  })

  it('renders a coloured positive amount', () => {
    render(<MoneyText cents={1_00} colored />)
    expect(screen.getByText('$1.00')).toBeInTheDocument()
  })

  it('renders a coloured negative amount', () => {
    render(<MoneyText cents={-1_00} colored />)
    expect(screen.getByText('-$1.00')).toBeInTheDocument()
  })

  it('renders a coloured zero amount', () => {
    render(<MoneyText cents={0} colored />)
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('passes a colour through when not coloured', () => {
    render(<MoneyText cents={0} c="dimmed" />)
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })
})
