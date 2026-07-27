import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '../test/render'
import { cycleIndex, flattenNavItems, isNavGroup, NAV_SECTIONS, TabBar } from './TabBar'

/** Resizes happy-dom's viewport so responsive (`hiddenFrom`/`visibleFrom`) rules resolve. */
function setViewportWidth(width: number) {
  ;(
    window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }
  ).happyDOM.setViewport({ width })
}

/** Reads the active route so tests can assert where a shortcut navigated. */
function LocationDisplay() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

function renderTabBar(initialPath: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TabBar sections={NAV_SECTIONS} />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

function pathname() {
  return screen.getByTestId('pathname').textContent
}

const NAV_ITEMS = flattenNavItems(NAV_SECTIONS)
const NAV_GROUPS = NAV_SECTIONS.filter(isNavGroup)

/** The sidebar's header button for the group labelled `label`. */
function groupHeader(label: string) {
  return screen.getByRole('button', { name: label })
}

/** The item list a group header controls, found via its `aria-controls` target. */
function groupItems(label: string) {
  const id = groupHeader(label).getAttribute('aria-controls') ?? ''
  const list = document.getElementById(id)
  if (!list) throw new Error(`No item list for the ${label} group`)
  return list
}

describe('TabBar', () => {
  it('renders a link per nav item with its route as href', () => {
    renderTabBar('/summary')

    for (const item of NAV_ITEMS) {
      // Items in a collapsed group stay mounted but hidden, so match those too.
      const link = screen.getByRole('link', { name: item.label, hidden: true })
      expect(link).toHaveAttribute('href', item.path)
    }
  })

  it('renders the desktop sidebar as a labelled nav landmark headed by the brand lockup', () => {
    renderTabBar('/summary')

    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).getByRole('img', { name: 'nest' })).toBeInTheDocument()

    const nav = within(sidebar).getByRole('navigation', { name: 'Primary' })
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label, hidden: true })).toBeInTheDocument()
    }
  })

  it('renders a header button per group, with Summary outside every one of them', () => {
    renderTabBar('/summary')

    for (const group of NAV_GROUPS) {
      expect(groupHeader(group.label)).toBeVisible()
    }
    expect(NAV_GROUPS.map((group) => group.label)).toEqual(['Plan', 'Grow', 'Tax', 'Settings'])

    // Summary is a link in its own right, never folded into a group's list.
    const summary = screen.getByRole('link', { name: 'Summary' })
    expect(summary).toBeVisible()
    for (const group of NAV_GROUPS) {
      expect(groupItems(group.label)).not.toContainElement(summary)
    }
  })

  it('opens the group holding the current route and leaves the rest closed', () => {
    renderTabBar('/budget')

    expect(groupHeader('Plan')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Budget' })).toBeVisible()

    for (const label of ['Grow', 'Tax', 'Settings']) {
      expect(groupHeader(label)).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.getByText('Net worth')).not.toBeVisible()
    expect(screen.getByText('Estimate')).not.toBeVisible()
    expect(screen.getByText("What's new")).not.toBeVisible()
  })

  it('leaves every group closed on a route that sits outside them', () => {
    renderTabBar('/summary')

    for (const group of NAV_GROUPS) {
      expect(groupHeader(group.label)).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.getByText('Inflows')).not.toBeVisible()
  })

  it('expands and collapses a group from its header', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.click(groupHeader('Tax'))

    expect(groupHeader('Tax')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Deductions' })).toBeVisible()

    await user.click(groupHeader('Tax'))

    expect(groupHeader('Tax')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Deductions')).not.toBeVisible()
  })

  it('keeps a hand-opened group open alongside the active one', async () => {
    const user = userEvent.setup()
    renderTabBar('/budget')

    await user.click(groupHeader('Grow'))

    expect(groupHeader('Plan')).toHaveAttribute('aria-expanded', 'true')
    expect(groupHeader('Grow')).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens the group a navigation lands in and closes the one left behind', async () => {
    const user = userEvent.setup()
    renderTabBar('/budget')

    await user.click(groupHeader('Settings'))
    await user.click(screen.getByRole('link', { name: 'Household' }))

    expect(pathname()).toBe('/household')
    expect(groupHeader('Settings')).toHaveAttribute('aria-expanded', 'true')
    expect(groupHeader('Plan')).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks a collapsed group that still holds the current route', async () => {
    const user = userEvent.setup()
    renderTabBar('/budget')

    expect(groupHeader('Plan')).not.toHaveAttribute('aria-current')

    await user.click(groupHeader('Plan'))

    const header = groupHeader('Plan')
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header).toHaveAttribute('aria-current', 'true')
    expect(header.querySelector('.drawer-nav__group-dot')).toBeInTheDocument()
    expect(groupHeader('Grow')).not.toHaveAttribute('aria-current')
  })

  it('marks the link for the current route as active', () => {
    renderTabBar('/budget')

    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
  })

  it('labels the tax tabs by what they hold, the group carrying the context', () => {
    renderTabBar('/tax')

    const tax = groupItems('Tax')
    expect(within(tax).getByRole('link', { name: 'Estimate' })).toHaveAttribute('href', '/tax')
    expect(within(tax).getByRole('link', { name: 'Deductions' })).toHaveAttribute(
      'href',
      '/deductions',
    )
    expect(within(tax).getByRole('link', { name: 'HELP debt' })).toHaveAttribute(
      'href',
      '/help-debt',
    )
    expect(within(tax).getByRole('link', { name: 'EOFY' })).toHaveAttribute('href', '/eofy')
  })

  it('jumps to the nth tab in flattened order on mod+number', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}2{/Control}')

    expect(pathname()).toBe('/inflows')
  })

  it('reaches a tab inside a collapsed group on mod+number, opening it', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    expect(groupHeader('Grow')).toHaveAttribute('aria-expanded', 'false')

    // Ninth in flattened order: Summary, then Plan's five, then Net worth, Goals, Super.
    await user.keyboard('{Control>}9{/Control}')

    expect(pathname()).toBe('/super')
    expect(groupHeader('Grow')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Super' })).toHaveAttribute('aria-current', 'page')
  })

  it('cycles to the next tab on mod+shift+ArrowRight', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect(pathname()).toBe('/inflows')
  })

  it('cycles across a group boundary on mod+shift+ArrowRight', async () => {
    const user = userEvent.setup()
    renderTabBar('/splits')

    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect(pathname()).toBe('/net-worth')
    expect(groupHeader('Grow')).toHaveAttribute('aria-expanded', 'true')
    expect(groupHeader('Plan')).toHaveAttribute('aria-expanded', 'false')
  })

  it('wraps to the last tab on mod+shift+ArrowLeft from the first tab', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}')

    expect(pathname()).toBe('/whats-new')
    expect(groupHeader('Settings')).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('TabBar mobile drawer', () => {
  // Below `sm` the sidebar hides and the top bar's hamburger drawer takes over,
  // so these run against a narrow viewport.
  beforeEach(() => setViewportWidth(375))
  afterEach(() => setViewportWidth(1024))

  it('shows only the brand mark in the top bar, not the active page title', () => {
    renderTabBar('/budget')

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('img', { name: 'nest' })).toBeInTheDocument()
    // The page title lives in-body via PageSection, so the top bar never labels it.
    expect(within(header).queryByText('Budget')).not.toBeInTheDocument()
    expect(header).toHaveTextContent('')
  })

  it('opens the hamburger drawer and navigates on selecting an item', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    const toggle = screen.getByRole('button', { name: 'Toggle navigation menu' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByRole('img', { name: 'nest' })).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Summary' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await user.click(within(drawer).getByRole('button', { name: 'Plan' }))
    await user.click(within(drawer).getByRole('link', { name: 'Budget' }))

    expect(pathname()).toBe('/budget')
  })

  it('renders the same groups as the sidebar, opened by the current route', async () => {
    const user = userEvent.setup()
    renderTabBar('/goals')

    await user.click(screen.getByRole('button', { name: 'Toggle navigation menu' }))

    const nav = within(screen.getByRole('dialog')).getByRole('navigation', { name: 'Primary' })
    for (const group of NAV_GROUPS) {
      expect(within(nav).getByRole('button', { name: group.label })).toBeVisible()
    }

    expect(within(nav).getByRole('button', { name: 'Grow' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(nav).getByRole('button', { name: 'Plan' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(nav).getByRole('link', { name: 'Goals' })).toBeVisible()
  })
})

describe('cycleIndex', () => {
  it('wraps past either end of the range', () => {
    expect(cycleIndex(0, 8)).toBe(0)
    expect(cycleIndex(8, 8)).toBe(0)
    expect(cycleIndex(-1, 8)).toBe(7)
  })
})

describe('flattenNavItems', () => {
  it('splices each group in place, keeping standalone items where they sit', () => {
    expect(NAV_ITEMS.map((item) => item.path)).toEqual([
      '/summary',
      '/inflows',
      '/budget',
      '/breakdowns',
      '/gifts',
      '/splits',
      '/net-worth',
      '/goals',
      '/super',
      '/equity',
      '/tax',
      '/payslips',
      '/deductions',
      '/help-debt',
      '/eofy',
      '/household',
      '/whats-new',
    ])
  })
})
