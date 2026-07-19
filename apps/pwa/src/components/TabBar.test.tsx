import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { buildNavGroups, cycleIndex, GroupedTabBar, NAV_ITEMS, TabBar } from './TabBar'

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

  it('marks the link for the current route as active', () => {
    render(
      <MemoryRouter initialEntries={['/budget']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
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

function renderGroupedTabBar(initialPath: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <GroupedTabBar items={NAV_ITEMS} />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

describe('GroupedTabBar', () => {
  it('navigates directly from a single-item group', async () => {
    const user = userEvent.setup()
    renderGroupedTabBar('/budget')

    await user.click(screen.getByRole('link', { name: 'Overview' }))

    expect(pathname()).toBe('/summary')
  })

  it('opens a multi-item group and navigates to a chosen destination', async () => {
    const user = userEvent.setup()
    renderGroupedTabBar('/summary')

    const toggle = screen.getByRole('button', { name: 'Plan' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Goals' }))

    expect(pathname()).toBe('/goals')
  })

  it('marks the active destination within an open group', async () => {
    const user = userEvent.setup()
    renderGroupedTabBar('/goals')

    await user.click(screen.getByRole('button', { name: 'Plan' }))

    expect(screen.getByRole('menuitem', { name: 'Goals' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('menuitem', { name: 'Budget' })).not.toHaveAttribute('aria-current')
  })
})

describe('buildNavGroups', () => {
  it('resolves grouping paths to their nav items', () => {
    const groups = buildNavGroups(NAV_ITEMS)

    expect(groups.map((group) => group.label)).toEqual(['Overview', 'Money', 'Plan', 'Settings'])
    expect(groups[2]?.items.map((item) => item.path)).toEqual(['/budget', '/goals'])
  })

  it('drops grouping paths with no matching nav item', () => {
    const groups = buildNavGroups([{ path: '/summary', label: 'Summary' }])

    expect(groups[0]?.items).toHaveLength(1)
    expect(groups[1]?.items).toHaveLength(0)
  })
})

describe('cycleIndex', () => {
  it('wraps past either end of the range', () => {
    expect(cycleIndex(0, 6)).toBe(0)
    expect(cycleIndex(6, 6)).toBe(0)
    expect(cycleIndex(-1, 6)).toBe(5)
  })
})
