import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { NAV_ITEMS, TabBar } from './TabBar'

describe('TabBar', () => {
  it('renders a link per nav item with its route as href', () => {
    render(
      <MemoryRouter initialEntries={['/summary']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    for (const item of NAV_ITEMS) {
      const link = screen.getByRole('link', { name: item.label })
      expect(link).toHaveAttribute('href', item.path)
    }
  })

  it('marks the link for the current route as active', () => {
    render(
      <MemoryRouter initialEntries={['/budget']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
  })
})
