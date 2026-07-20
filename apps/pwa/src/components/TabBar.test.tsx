import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '../test/render'
import { cycleIndex, NAV_ITEMS, TabBar } from './TabBar'

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

  it('renders the desktop sidebar as a labelled nav landmark', () => {
    render(
      <MemoryRouter initialEntries={['/summary']}>
        <TabBar items={NAV_ITEMS} />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label })).toBeInTheDocument()
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

    expect(pathname()).toBe('/net-worth')
  })

  it('exposes the Breakdowns tab and jumps to it on mod+9', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    expect(screen.getByRole('link', { name: 'Breakdowns' })).toHaveAttribute('href', '/breakdowns')

    await user.keyboard('{Control>}9{/Control}')

    expect(pathname()).toBe('/breakdowns')
  })

  it('cycles to the next tab on mod+shift+ArrowRight', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}')

    expect(pathname()).toBe('/net-worth')
  })

  it('wraps to the last tab on mod+shift+ArrowLeft from the first tab', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}')

    expect(pathname()).toBe('/whats-new')
  })
})

describe('TabBar mobile drawer', () => {
  // Below `sm` the sidebar hides and the top bar's hamburger drawer takes over,
  // so these run against a narrow viewport.
  beforeEach(() => setViewportWidth(375))
  afterEach(() => setViewportWidth(1024))

  it('shows the app icon and active page title in the top bar', () => {
    renderTabBar('/budget')

    const header = screen.getByRole('banner')
    expect(within(header).getByAltText('Nest')).toBeInTheDocument()
    expect(within(header).getByText('Budget')).toBeInTheDocument()
  })

  it('opens the hamburger drawer and navigates on selecting an item', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    const toggle = screen.getByRole('button', { name: 'Toggle navigation menu' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByRole('link', { name: 'Summary' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await user.click(within(drawer).getByRole('link', { name: 'Budget' }))

    expect(pathname()).toBe('/budget')
  })
})

describe('cycleIndex', () => {
  it('wraps past either end of the range', () => {
    expect(cycleIndex(0, 8)).toBe(0)
    expect(cycleIndex(8, 8)).toBe(0)
    expect(cycleIndex(-1, 8)).toBe(7)
  })
})
