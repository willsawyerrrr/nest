import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '../test/render'
import { cycleIndex, NAV_ITEMS, TabBar } from './TabBar'

// The suite pins `matchMedia` to the narrow layout (see `test/setup.ts`), so
// `TabBar` renders the mobile scrollable top bar: a `tablist` of `tab` links.

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
  it('renders a tab per nav item with its route as href', () => {
    render(
      <MemoryRouter initialEntries={['/summary']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    for (const item of NAV_ITEMS) {
      const tab = screen.getByRole('tab', { name: item.label })
      expect(tab).toHaveAttribute('href', item.path)
    }
  })

  it('renders every nav item in a single scrollable tablist', () => {
    render(
      <MemoryRouter initialEntries={['/summary']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    const tablist = screen.getByRole('tablist', { name: 'Primary' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(NAV_ITEMS.map((item) => item.label))
  })

  it('marks the tab for the current route as active', () => {
    render(
      <MemoryRouter initialEntries={['/budget']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    const budget = screen.getByRole('tab', { name: 'Budget' })
    expect(budget).toHaveAttribute('aria-current', 'page')
    expect(budget).toHaveAttribute('aria-selected', 'true')
    const summary = screen.getByRole('tab', { name: 'Summary' })
    expect(summary).not.toHaveAttribute('aria-current')
    expect(summary).toHaveAttribute('aria-selected', 'false')
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
