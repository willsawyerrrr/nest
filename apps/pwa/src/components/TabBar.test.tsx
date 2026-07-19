import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '../test/render'
import { cycleIndex, NAV_ITEMS, TabBar } from './TabBar'

/** Reads the active route so tests can assert where a shortcut navigated. */
function LocationDisplay() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

/**
 * Pins `matchMedia` so `useMediaQuery('(min-width: 48em)')` resolves to a
 * chosen viewport: `true` selects the full desktop bar, `false` the mobile
 * "More"-overflow bar.
 */
function setDesktop(isDesktop: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('min-width') ? isDesktop : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList
}

// Default to the mobile bar; desktop tests opt in explicitly.
beforeEach(() => setDesktop(false))

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

describe('TabBar on desktop', () => {
  beforeEach(() => setDesktop(true))

  it('renders a link per nav item with its route as href', async () => {
    renderTabBar('/summary')

    for (const item of NAV_ITEMS) {
      const link = await screen.findByRole('link', { name: item.label })
      expect(link).toHaveAttribute('href', item.path)
    }
    expect(screen.queryByRole('button', { name: 'More navigation' })).toBeNull()
  })

  it('marks the link for the current route as active', async () => {
    renderTabBar('/budget')

    expect(await screen.findByRole('link', { name: 'Budget' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
  })
})

describe('TabBar on mobile', () => {
  it('shows the first four tabs plus a More toggle, tucking the rest away', () => {
    renderTabBar('/summary')

    for (const item of NAV_ITEMS.slice(0, 4)) {
      expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.path)
    }
    for (const item of NAV_ITEMS.slice(4)) {
      expect(screen.queryByRole('link', { name: item.label })).toBeNull()
    }

    const more = screen.getByRole('button', { name: 'More navigation' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAttribute('aria-controls', 'nav-more-sheet')
    expect(more).not.toHaveAttribute('aria-current')
  })

  it('marks a primary tab active without opening More', () => {
    renderTabBar('/budget')

    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'More navigation' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('marks More active when the route lives in the overflow', () => {
    renderTabBar('/tax')

    expect(screen.getByRole('button', { name: 'More navigation' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('opens More, navigates to an overflow tab, and closes the sheet', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    const more = screen.getByRole('button', { name: 'More navigation' })
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')

    await user.click(await screen.findByRole('link', { name: 'Household' }))

    expect(pathname()).toBe('/household')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Household' })).toBeNull())
    expect(more).toHaveAttribute('aria-current', 'page')
  })
})

describe('TabBar hotkeys', () => {
  it('jumps to the nth tab on mod+number', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}2{/Control}')

    expect(pathname()).toBe('/inflows')
  })

  it('reaches an overflow tab by number without opening More', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}5{/Control}')

    expect(pathname()).toBe('/tax')
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
