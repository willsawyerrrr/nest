import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '../test/render'
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

// happy-dom pins `matchMedia` to `matches: false`, so the media query stays
// unmatched and these tests exercise the mobile bar-plus-drawer variant.
describe('TabBar', () => {
  it('renders a drawer link per nav item with its route as href', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.click(screen.getByRole('button', { name: 'More navigation' }))

    const drawer = screen.getByRole('dialog')
    for (const item of NAV_ITEMS) {
      const link = within(drawer).getByRole('link', { name: item.label })
      expect(link).toHaveAttribute('href', item.path)
    }
  })

  it('marks the essential tab for the current route as active', () => {
    renderTabBar('/budget')

    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
  })

  it('opens the drawer and navigates to a non-essential tab, then closes it', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    const toggle = screen.getByRole('button', { name: 'More navigation' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const drawer = screen.getByRole('dialog')
    await user.click(within(drawer).getByRole('link', { name: 'Tax' }))

    expect(pathname()).toBe('/tax')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
