import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { AppCard } from './AppCard'

describe('AppCard', () => {
  it('renders its children', () => {
    render(<AppCard>Inside</AppCard>)
    expect(screen.getByText('Inside')).toBeInTheDocument()
  })

  it('renders a compact card', () => {
    render(<AppCard density="compact">Compact</AppCard>)
    expect(screen.getByText('Compact')).toBeInTheDocument()
  })

  it('honours an explicit padding over the density preset', () => {
    render(
      <AppCard density="compact" padding="xl">
        Padded
      </AppCard>,
    )
    expect(screen.getByText('Padded')).toBeInTheDocument()
  })
})
