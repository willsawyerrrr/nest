import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { PageSection } from './PageSection'

describe('PageSection', () => {
  it('renders the title as the level-1 display heading and its children', () => {
    render(<PageSection title="Inflows">Body</PageSection>)
    expect(screen.getByRole('heading', { level: 1, name: 'Inflows' })).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('renders optional intro copy', () => {
    render(
      <PageSection title="Budget" intro="Plan your fortnight">
        Body
      </PageSection>,
    )
    expect(screen.getByText('Plan your fortnight')).toBeInTheDocument()
  })

  it('omits the intro when not given', () => {
    render(<PageSection title="Goals">Body</PageSection>)
    expect(screen.queryByText('Plan your fortnight')).not.toBeInTheDocument()
  })
})
