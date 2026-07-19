/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Text, UnstyledButton, useMantineTheme } from '@mantine/core'
import { useHotkeys, useMediaQuery, type HotkeyItem } from '@mantine/hooks'

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

/** Nav items shown as tabs on mobile before the rest collapse into the More menu. */
const MOBILE_PRIMARY_COUNT = 4

/** Wraps `index` into `[0, length)`, cycling past either end. */
export function cycleIndex(index: number, length: number) {
  return ((index % length) + length) % length
}

/** Index of the tab whose route `pathname` sits under, or `-1` if none. */
export function tabIndexForPath(items: NavItem[], pathname: string) {
  return items.findIndex((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

/** A single route link styled as a tab, highlighting itself when active. */
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

/** Fixed bottom bar listing every tab side by side; the desktop (`sm`+) layout. */
function FullTabBar({ items }: { items: NavItem[] }) {
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

/**
 * Fixed top bar showing the first few tabs plus a More button that opens the
 * remaining tabs in an overflow menu; the mobile (base→`sm`) layout.
 */
function MoreTabBar({ items, currentIndex }: { items: NavItem[]; currentIndex: number }) {
  const navigate = useNavigate()
  const [opened, setOpened] = useState(false)
  const primary = items.slice(0, MOBILE_PRIMARY_COUNT)
  const overflow = items.slice(MOBILE_PRIMARY_COUNT)
  const overflowActive = currentIndex >= MOBILE_PRIMARY_COUNT

  return (
    <nav className="top-bar" aria-label="Primary">
      <div className="top-bar__list">
        {primary.map((item) => (
          <TabLink key={item.path} item={item} />
        ))}
        {overflow.length > 0 && (
          <Menu opened={opened} onChange={setOpened} position="bottom-end">
            <Menu.Target>
              <UnstyledButton
                type="button"
                className="tab-bar__tab"
                aria-label="More navigation"
                aria-current={overflowActive ? 'page' : undefined}
              >
                <Text
                  size="sm"
                  fw={overflowActive ? 700 : 500}
                  c={overflowActive ? 'var(--mantine-primary-color-filled)' : 'dimmed'}
                >
                  More
                </Text>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              {overflow.map((item, index) => (
                <Menu.Item
                  key={item.path}
                  aria-current={currentIndex === MOBILE_PRIMARY_COUNT + index ? 'page' : undefined}
                  onClick={() => {
                    navigate(item.path)
                    setOpened(false)
                  }}
                >
                  {item.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </div>
    </nav>
  )
}

/**
 * Route-aware primary navigation. Renders the full bottom bar on desktop and the
 * More-overflow top bar on mobile, wiring `mod+N` jumps and `mod+shift+Arrow`
 * cycling across every tab regardless of which layout is on screen.
 */
export function TabBar({ items }: { items: NavItem[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const theme = useMantineTheme()
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`, false)
  const currentIndex = tabIndexForPath(items, pathname)

  /** Navigates `offset` tabs away from the current one, wrapping at the ends. */
  const cycleTo = (offset: number) => {
    const next = items[cycleIndex(currentIndex + offset, items.length)]
    if (next) navigate(next.path)
  }

  // `mod+1`…`mod+N` jump to a tab by position; `mod+shift+Arrow` cycles with
  // wrap-around. Both cover every tab, including those inside More. `Ctrl+Tab` is
  // avoided: browsers reserve it for their own tab switching and JS cannot
  // reliably intercept it. `useHotkeys` ignores events from
  // `input`/`textarea`/`select`/contentEditable by default, so shortcuts stay
  // dormant while typing.
  const hotkeys: HotkeyItem[] = [
    ...items.map((item, index): HotkeyItem => [`mod+${index + 1}`, () => navigate(item.path)]),
    ['mod+shift+ArrowRight', () => cycleTo(1)],
    ['mod+shift+ArrowLeft', () => cycleTo(-1)],
  ]
  useHotkeys(hotkeys)

  return isDesktop ? (
    <FullTabBar items={items} />
  ) : (
    <MoreTabBar items={items} currentIndex={currentIndex} />
  )
}
