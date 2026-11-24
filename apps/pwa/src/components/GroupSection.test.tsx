import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { GroupSection } from './GroupSection'

describe('GroupSection', () => {
  it('renders the title, its fortnightly subtotal, and its children', () => {
    render(
      <GroupSection title="Needs" subtotalCents={12345}>
        <div>child content</div>
      </GroupSection>,
    )

    expect(screen.getByRole('heading', { name: 'Needs' })).toBeInTheDocument()
    expect(screen.getByLabelText('Needs fortnightly subtotal')).toHaveTextContent('$123.45 / fn')
    expect(screen.getByText('child content')).toBeInTheDocument()
    expect(screen.queryByLabelText('Needs actual spend')).not.toBeInTheDocument()
  })

  it('shows the actual spend and what is left', () => {
    render(
      <GroupSection title="Needs" subtotalCents={500_00} actualCents={320_50}>
        <div />
      </GroupSection>,
    )

    expect(screen.getByLabelText('Needs actual spend')).toHaveTextContent('$320.50 spent')
    expect(screen.getByLabelText('Needs left to spend')).toHaveTextContent('$179.50 left')
  })

  it('shows by how much the spend went over', () => {
    render(
      <GroupSection title="Wants" subtotalCents={100_00} actualCents={125_00}>
        <div />
      </GroupSection>,
    )

    expect(screen.getByLabelText('Wants left to spend')).toHaveTextContent('$25.00 over')
  })
})
