import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { buildNavGroups, cycleIndex, FullTabBar, GroupedTopBar, NAV_ITEMS, TabBar } from './TabBar'

/** Reads the active route so tests can assert where a shortcut navigated. */
function LocationDisplay() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

function renderAt(initialPath: string, ui: ReactNode) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      {ui}
      <LocationDisplay />
    </MemoryRouter>,
  )
}

function pathname() {
  return screen.getByTestId('pathname').textContent
}

describe('FullTabBar', () => {
  it('renders a link per nav item with its route as href', () => {
    renderAt('/summary', <FullTabBar items={NAV_ITEMS} />)

    for (const item of NAV_ITEMS) {
      const link = screen.getByRole('link', { name: item.label })
      expect(link).toHaveAttribute('href', item.path)
    }
  })

  it('marks the link for the current route as active', () => {
    renderAt('/budget', <FullTabBar items={NAV_ITEMS} />)

    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
  })
})

describe('GroupedTopBar', () => {
  it('links single-item groups straight to their route', () => {
    renderAt('/summary', <GroupedTopBar items={NAV_ITEMS} />)

    const overview = screen.getByRole('link', { name: 'Overview' })
    expect(overview).toHaveAttribute('href', '/summary')
    expect(overview).toHaveAttribute('aria-current', 'page')
  })

  it('renders multi-item groups as collapsed menu buttons', () => {
    renderAt('/summary', <GroupedTopBar items={NAV_ITEMS} />)

    const plan = screen.getByRole('button', { name: 'Plan menu' })
    expect(plan).toHaveAttribute('aria-haspopup', 'menu')
    expect(plan).toHaveAttribute('aria-expanded', 'false')
    // The submenu items only mount once the group is opened.
    expect(screen.queryByRole('menuitem', { name: 'Budget' })).not.toBeInTheDocument()
  })

  it('opens a group submenu and navigates to a chosen route', async () => {
    const user = userEvent.setup()
    renderAt('/summary', <GroupedTopBar items={NAV_ITEMS} />)

    const plan = screen.getByRole('button', { name: 'Plan menu' })
    await user.click(plan)

    expect(plan).toHaveAttribute('aria-expanded', 'true')
    expect(plan).toHaveAttribute('aria-controls')

    await user.click(screen.getByRole('menuitem', { name: 'Goals' }))

    expect(pathname()).toBe('/goals')
  })

  it('marks the active route within an open submenu', async () => {
    const user = userEvent.setup()
    renderAt('/budget', <GroupedTopBar items={NAV_ITEMS} />)

    await user.click(screen.getByRole('button', { name: 'Plan menu' }))

    expect(screen.getByRole('menuitem', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('menuitem', { name: 'Goals' })).not.toHaveAttribute('aria-current')
  })
})

describe('TabBar shortcuts', () => {
  it('jumps to the nth tab on mod+number', async () => {
    const user = userEvent.setup()
    renderAt('/summary', <TabBar items={NAV_ITEMS} />)

    await user.keyboard('{Control>}2{/Control}')

    expect(pathname()).toBe('/inflows')
  })

  it('cycles to the next tab on mod+shift+ArrowRight', async () => {
    const user = userEvent.setup()
    renderAt('/summary', <TabBar items={NAV_ITEMS} />)

    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect(pathname()).toBe('/inflows')
  })

  it('wraps to the last tab on mod+shift+ArrowLeft from the first tab', async () => {
    const user = userEvent.setup()
    renderAt('/summary', <TabBar items={NAV_ITEMS} />)

    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}')

    expect(pathname()).toBe('/household')
  })
})

describe('buildNavGroups', () => {
  it('resolves each group table row to its nav items in order', () => {
    const groups = buildNavGroups(NAV_ITEMS)

    expect(groups.map((group) => group.label)).toEqual(['Overview', 'Money', 'Plan', 'Settings'])
    expect(groups.map((group) => group.items.map((item) => item.path))).toEqual([
      ['/summary'],
      ['/inflows'],
      ['/budget', '/goals'],
      ['/tax', '/household'],
    ])
  })
})

describe('cycleIndex', () => {
  it('wraps past either end of the range', () => {
    expect(cycleIndex(0, 6)).toBe(0)
    expect(cycleIndex(6, 6)).toBe(0)
    expect(cycleIndex(-1, 6)).toBe(5)
  })
})
