/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Text } from '@mantine/core'
import { useHotkeys, type HotkeyItem } from '@mantine/hooks'

export type NavItem = { path: string; label: string }

/** Primary navigation targets, one per top-level route, in display order. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/summary', label: 'Summary' },
  { path: '/inflows', label: 'Inflows' },
  { path: '/budget', label: 'Budget' },
  { path: '/goals', label: 'Goals' },
  { path: '/tax', label: 'Tax' },
  { path: '/household', label: 'Household' },
]

/** Wraps `index` into `[0, length)`, cycling past either end. */
export function cycleIndex(index: number, length: number) {
  return ((index % length) + length) % length
}

/** Index of the tab whose route `pathname` sits under, or `-1` if none. */
export function tabIndexForPath(items: NavItem[], pathname: string) {
  return items.findIndex((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

/** Fixed bottom tab bar whose active tab tracks the current route. */
export function TabBar({ items }: { items: NavItem[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const currentIndex = tabIndexForPath(items, pathname)

  /** Navigates `offset` tabs away from the current one, wrapping at the ends. */
  const cycleTo = (offset: number) => {
    const next = items[cycleIndex(currentIndex + offset, items.length)]
    if (next) navigate(next.path)
  }

  // `mod+1`…`mod+N` jump to a tab by position; `mod+shift+Arrow` cycles with
  // wrap-around. `Ctrl+Tab` is avoided: browsers reserve it for their own tab
  // switching and JS cannot reliably intercept it. `useHotkeys` ignores events
  // from `input`/`textarea`/`select`/contentEditable by default, so shortcuts
  // stay dormant while typing.
  const hotkeys: HotkeyItem[] = [
    ...items.map((item, index): HotkeyItem => [`mod+${index + 1}`, () => navigate(item.path)]),
    ['mod+shift+ArrowRight', () => cycleTo(1)],
    ['mod+shift+ArrowLeft', () => cycleTo(-1)],
  ]
  useHotkeys(hotkeys)

  return (
    <nav className="tab-bar" aria-label="Primary">
      <div className="tab-bar__list">
        {items.map((item) => (
          <NavLink key={item.path} to={item.path} className="tab-bar__tab">
            {({ isActive }) => (
              <Text
                size="sm"
                fw={isActive ? 700 : 500}
                c={isActive ? 'var(--mantine-primary-color-filled)' : 'dimmed'}
              >
                {item.label}
              </Text>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
