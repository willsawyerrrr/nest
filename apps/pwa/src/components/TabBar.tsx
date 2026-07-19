/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Box, Burger, Drawer, Group, Stack, Text } from '@mantine/core'
import { useDisclosure, useHotkeys, type HotkeyItem } from '@mantine/hooks'

export type NavItem = { path: string; label: string }

/** Primary navigation targets, one per top-level route, in display order. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/summary', label: 'Summary' },
  { path: '/net-worth', label: 'Net worth' },
  { path: '/inflows', label: 'Inflows' },
  { path: '/budget', label: 'Budget' },
  { path: '/goals', label: 'Goals' },
  { path: '/tax', label: 'Tax' },
  { path: '/super', label: 'Super' },
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

const DRAWER_ID = 'primary-nav-drawer'

/**
 * Vertical list of every nav item as a labelled `nav` landmark. The mobile
 * drawer and the desktop sidebar both render it, so the two variants share one
 * item style and active-highlight treatment. `onNavigate` fires after a tab is
 * chosen, letting the drawer close itself on selection.
 */
function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <Stack gap={4} component="nav" aria-label="Primary">
      {items.map((item) => (
        <NavLink key={item.path} to={item.path} onClick={onNavigate} className="drawer-nav__link">
          {({ isActive }) => (
            <Text
              size="lg"
              fw={isActive ? 700 : 500}
              c={isActive ? 'var(--mantine-primary-color-filled)' : undefined}
            >
              {item.label}
            </Text>
          )}
        </NavLink>
      ))}
    </Stack>
  )
}

/**
 * Route-aware primary navigation. On mobile it is a fixed top bar with a
 * hamburger that opens a drawer of every nav item; on desktop (`sm` and up) it
 * is a persistent left sidebar listing the same items. Both variants stay
 * driven by `items`, so a new tab appears everywhere at once.
 */
export function TabBar({ items }: { items: NavItem[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const currentIndex = tabIndexForPath(items, pathname)
  const [drawerOpened, drawer] = useDisclosure(false)

  /** Navigates `offset` tabs away from the current one, wrapping at the ends. */
  const cycleTo = (offset: number) => {
    const next = items[cycleIndex(currentIndex + offset, items.length)]
    if (next) navigate(next.path)
  }

  // `mod+1`…`mod+N` jump to a tab by position; `mod+shift+Arrow` cycles with
  // wrap-around. `Ctrl+Tab` is avoided: browsers reserve it for their own tab
  // switching and JS cannot reliably intercept it. `useHotkeys` ignores events
  // from `input`/`textarea`/`select`/contentEditable by default, so shortcuts
  // stay dormant while typing. Shortcuts are wired once and drive both variants.
  const hotkeys: HotkeyItem[] = [
    ...items.map((item, index): HotkeyItem => [`mod+${index + 1}`, () => navigate(item.path)]),
    ['mod+shift+ArrowRight', () => cycleTo(1)],
    ['mod+shift+ArrowLeft', () => cycleTo(-1)],
  ]
  useHotkeys(hotkeys)

  const activeLabel = items[currentIndex]?.label

  return (
    <>
      <Box component="header" className="top-bar" hiddenFrom="sm">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={700}>Budget</Text>
            {activeLabel ? (
              <Text size="sm" c="dimmed" truncate>
                {activeLabel}
              </Text>
            ) : null}
          </Group>
          <Burger
            opened={drawerOpened}
            onClick={drawer.toggle}
            size="sm"
            aria-label="Toggle navigation menu"
            aria-expanded={drawerOpened}
            aria-controls={DRAWER_ID}
          />
        </Group>
      </Box>

      <Drawer
        id={DRAWER_ID}
        opened={drawerOpened}
        onClose={drawer.close}
        position="left"
        size="xs"
        title="Navigation"
        hiddenFrom="sm"
      >
        <NavList items={items} onNavigate={drawer.close} />
      </Drawer>

      <Box component="aside" className="sidebar" visibleFrom="sm">
        <Text fw={700} size="lg" mb="md" px="xs">
          Budget
        </Text>
        <NavList items={items} />
      </Box>
    </>
  )
}
