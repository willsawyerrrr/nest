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
  })
})
