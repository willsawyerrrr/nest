/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { useId } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Drawer, Stack, Text } from '@mantine/core'
import { useDisclosure, useHotkeys, useMediaQuery, type HotkeyItem } from '@mantine/hooks'

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

/**
 * Paths surfaced directly in the mobile bottom bar; every other tab is reached
 * through the drawer. Referencing paths keeps the essentials in step with
 * `NAV_ITEMS` while leaving that table the single source of the full set.
 */
export const ESSENTIAL_PATHS = ['/summary', '/budget', '/goals']

/** Wraps `index` into `[0, length)`, cycling past either end. */
export function cycleIndex(index: number, length: number) {
  return ((index % length) + length) % length
}

/** Index of the tab whose route `pathname` sits under, or `-1` if none. */
export function tabIndexForPath(items: NavItem[], pathname: string) {
  return items.findIndex((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

/** A nav link styled as a bottom-bar tab, active when it matches the route. */
function TabLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.path} className="tab-bar__tab">
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
  )
}

/**
 * Bottom navigation whose active tab tracks the current route. On desktop
 * (Mantine `sm` and up) every tab shows in one horizontal bar; on mobile the
 * bar keeps the essentials and a menu button opens a drawer listing every tab.
 */
export function TabBar({ items }: { items: NavItem[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const currentIndex = tabIndexForPath(items, pathname)
  const [drawerOpened, drawer] = useDisclosure(false)
  const drawerId = useId()
  // Mantine `sm` breakpoint (48em); below it the compact drawer nav applies.
  const wide = useMediaQuery('(min-width: 48em)', false, { getInitialValueInEffect: false })

  /** Navigates `offset` tabs away from the current one, wrapping at the ends. */
  const cycleTo = (offset: number) => {
    const next = items[cycleIndex(currentIndex + offset, items.length)]
    if (next) navigate(next.path)
  }

  // `mod+1`…`mod+N` jump to a tab by position; `mod+shift+Arrow` cycles with
  // wrap-around. Hotkeys span every tab regardless of which are shown in the
  // bar, so the drawer-only tabs stay reachable from the keyboard. `Ctrl+Tab`
  // is avoided: browsers reserve it for their own tab switching and JS cannot
  // reliably intercept it. `useHotkeys` ignores events from
  // `input`/`textarea`/`select`/contentEditable by default, so shortcuts stay
  // dormant while typing.
  const hotkeys: HotkeyItem[] = [
    ...items.map((item, index): HotkeyItem => [`mod+${index + 1}`, () => navigate(item.path)]),
    ['mod+shift+ArrowRight', () => cycleTo(1)],
    ['mod+shift+ArrowLeft', () => cycleTo(-1)],
  ]
  useHotkeys(hotkeys)

  if (wide) {
    return (
      <nav className="tab-bar" aria-label="Primary">
        <div className="tab-bar__list">
          {items.map((item) => (
            <TabLink key={item.path} item={item} />
          ))}
        </div>
      </nav>
    )
  }

  const essentials = items.filter((item) => ESSENTIAL_PATHS.includes(item.path))

  return (
    <>
      <nav className="tab-bar" aria-label="Primary">
        <div className="tab-bar__list">
          {essentials.map((item) => (
            <TabLink key={item.path} item={item} />
          ))}
          <button
            type="button"
            className="tab-bar__tab tab-bar__menu"
            aria-label="More navigation"
            aria-haspopup="dialog"
            aria-expanded={drawerOpened}
            aria-controls={drawerId}
            onClick={drawer.toggle}
          >
            <Text size="sm" fw={500} c="dimmed">
              ☰ More
            </Text>
          </button>
        </div>
      </nav>
      <Drawer
        id={drawerId}
        opened={drawerOpened}
        onClose={drawer.close}
        position="bottom"
        size="auto"
        title="Navigate"
      >
        <Stack gap={4} component="nav" aria-label="All sections">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className="drawer-nav__item"
              onClick={drawer.close}
            >
              {({ isActive }) => (
                <Text
                  fw={isActive ? 700 : 500}
                  c={isActive ? 'var(--mantine-primary-color-filled)' : undefined}
                >
                  {item.label}
                </Text>
              )}
            </NavLink>
          ))}
        </Stack>
      </Drawer>
    </>
  )
}
