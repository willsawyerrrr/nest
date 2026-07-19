import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test/render'
import { cycleIndex, NAV_ITEMS, TabBar } from './TabBar'

// happy-dom's `matchMedia` is pinned to `matches: false` (see `test/setup.ts`),
// so `TabBar` renders its mobile More-overflow layout in these tests: the first
// four items are tabs and the rest live behind the More button.
const PRIMARY = NAV_ITEMS.slice(0, 4)
const OVERFLOW = NAV_ITEMS.slice(4)

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
  it('renders a link per primary nav item with its route as href', () => {
    renderTabBar('/summary')

    for (const item of PRIMARY) {
      const link = screen.getByRole('link', { name: item.label })
      expect(link).toHaveAttribute('href', item.path)
    }
  })

  it('collapses overflow items behind an accessible More button', () => {
    renderTabBar('/summary')

    const more = screen.getByRole('button', { name: 'More navigation' })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    for (const item of OVERFLOW) {
      expect(screen.queryByRole('link', { name: item.label })).not.toBeInTheDocument()
    }
  })

  it('marks the link for the current route as active', () => {
    renderTabBar('/budget')

    expect(screen.getByRole('link', { name: 'Budget' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
  })

  it('marks the More button active when the route lives inside it', () => {
    renderTabBar('/tax')

    expect(screen.getByRole('button', { name: 'More navigation' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('navigates and closes when an item inside More is chosen', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    const more = screen.getByRole('button', { name: 'More navigation' })
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')

    await user.click(await screen.findByRole('menuitem', { name: 'Tax' }))

    expect(pathname()).toBe('/tax')
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  it('jumps to the nth tab on mod+number, including tabs inside More', async () => {
    const user = userEvent.setup()
    renderTabBar('/summary')

    await user.keyboard('{Control>}2{/Control}')
    expect(pathname()).toBe('/inflows')

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
