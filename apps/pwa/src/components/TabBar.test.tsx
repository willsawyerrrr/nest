import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { cycleIndex, NAV_ITEMS, TabBar } from './TabBar'

/** Reads the active route so tests can assert where a shortcut navigated. */
function LocationDisplay() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

function renderTabBar(initialPath: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TabBar items={NAV_ITEMS} />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

function pathname() {
  return screen.getByTestId('pathname').textContent
}

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

  // The mobile bar is CSS-hidden from the `sm` breakpoint up, and jsdom lays out
  // at a desktop width, so these queries opt into hidden elements to assert the
  // scrollable row's structure regardless of the simulated viewport.
  it('renders every tab in the scrollable mobile row as a tablist', () => {
    render(
      <MemoryRouter initialEntries={['/summary']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('tablist', { name: 'Primary', hidden: true })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab', { hidden: true })
    expect(tabs.map((tab) => tab.textContent)).toEqual(NAV_ITEMS.map((item) => item.label))
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('tab', { name: item.label, hidden: true })).toHaveAttribute(
        'href',
        item.path,
      )
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

  it('carries aria-current on the active tab in the scrollable row', () => {
    render(
      <MemoryRouter initialEntries={['/budget']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('tab', { name: 'Budget', hidden: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('tab', { name: 'Summary', hidden: true })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('jumps to the nth tab on mod+number', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}2{/Control}')

    expect(pathname()).toBe('/inflows')
  })

  it('cycles to the next tab on mod+shift+ArrowRight', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect(pathname()).toBe('/inflows')
  })

  it('wraps to the last tab on mod+shift+ArrowLeft from the first tab', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}')

    expect(pathname()).toBe('/household')
  })
})

describe('cycleIndex', () => {
  it('wraps past either end of the range', () => {
    expect(cycleIndex(0, 6)).toBe(0)
    expect(cycleIndex(6, 6)).toBe(0)
    expect(cycleIndex(-1, 6)).toBe(5)
  })
})
