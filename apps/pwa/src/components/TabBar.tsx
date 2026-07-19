/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Text, UnstyledButton } from '@mantine/core'
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

/**
 * Groups the nav items into labelled sections for the compact top bar. Each row
 * lists the item paths it collects, so the grouping stays data-driven off
 * `NAV_ITEMS` rather than duplicating labels or routes.
 */
export const NAV_GROUP_TABLE: { label: string; paths: string[] }[] = [
  { label: 'Overview', paths: ['/summary'] },
  { label: 'Money', paths: ['/inflows'] },
  { label: 'Plan', paths: ['/budget', '/goals'] },
  { label: 'Settings', paths: ['/tax', '/household'] },
]

export type NavGroup = { label: string; items: NavItem[] }

/** Resolves each group's paths against `items`, preserving `NAV_ITEMS` order. */
export function buildNavGroups(
  items: NavItem[],
  table: typeof NAV_GROUP_TABLE = NAV_GROUP_TABLE,
): NavGroup[] {
  return table.map((group) => ({
    label: group.label,
    items: group.paths
      .map((path) => items.find((item) => item.path === path))
      .filter((item): item is NavItem => item !== undefined),
  }))
}

/** Wraps `index` into `[0, length)`, cycling past either end. */
export function cycleIndex(index: number, length: number) {
  return ((index % length) + length) % length
}

/** Whether `pathname` sits on `path` or a route nested beneath it. */
function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`)
}

/** Index of the tab whose route `pathname` sits under, or `-1` if none. */
export function tabIndexForPath(items: NavItem[], pathname: string) {
  return items.findIndex((item) => matchesPath(pathname, item.path))
}

/**
 * Registers the navigation shortcuts shared by every bar variant: `mod+1`…
 * `mod+N` jump to a tab by position and `mod+shift+Arrow` cycles with
 * wrap-around. `Ctrl+Tab` is avoided: browsers reserve it for their own tab
 * switching and JS cannot reliably intercept it. `useHotkeys` ignores events
 * from `input`/`textarea`/`select`/contentEditable by default, so shortcuts stay
 * dormant while typing.
 */
function useNavHotkeys(items: NavItem[]) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const currentIndex = tabIndexForPath(items, pathname)

  const cycleTo = (offset: number) => {
    const next = items[cycleIndex(currentIndex + offset, items.length)]
    if (next) navigate(next.path)
  }

  const hotkeys: HotkeyItem[] = [
    ...items.map((item, index): HotkeyItem => [`mod+${index + 1}`, () => navigate(item.path)]),
    ['mod+shift+ArrowRight', () => cycleTo(1)],
    ['mod+shift+ArrowLeft', () => cycleTo(-1)],
  ]
  useHotkeys(hotkeys)
}

/** Fixed bottom tab bar with one tab per nav item; the primary desktop layout. */
export function FullTabBar({ items }: { items: NavItem[] }) {
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

/** A group's label styled to read as active or dimmed. */
function GroupLabel({ label, active }: { label: string; active: boolean }) {
  return (
    <Text
      size="sm"
      fw={active ? 700 : 500}
      c={active ? 'var(--mantine-primary-color-filled)' : 'dimmed'}
    >
      {label}
    </Text>
  )
}

/**
 * Fixed top app bar that collapses the nav into labelled groups; the mobile
 * layout. A single-item group links straight to its route, while a multi-item
 * group is a button that opens a menu to pick between its routes. The group
 * holding the active route is highlighted.
 */
export function GroupedTopBar({ items }: { items: NavItem[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const groups = buildNavGroups(items)

  return (
    <nav className="nav-top" aria-label="Primary">
      <div className="nav-top__list">
        {groups.map((group) => {
          const active = group.items.some((item) => matchesPath(pathname, item.path))
          const [firstItem, ...rest] = group.items

          if (firstItem && rest.length === 0) {
            return (
              <NavLink key={group.label} to={firstItem.path} className="nav-top__group">
                {({ isActive }) => <GroupLabel label={group.label} active={isActive} />}
              </NavLink>
            )
          }

          return (
            <Menu key={group.label} position="bottom" trigger="click" withinPortal>
              <Menu.Target>
                <UnstyledButton className="nav-top__group" aria-label={`${group.label} menu`}>
                  <GroupLabel label={group.label} active={active} />
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                {group.items.map((item) => (
                  <Menu.Item
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    aria-current={matchesPath(pathname, item.path) ? 'page' : undefined}
                  >
                    {item.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )
        })}
      </div>
    </nav>
  )
}

/**
 * Primary navigation whose shortcuts and active state track the current route.
 * Renders the grouped top bar on mobile and the full bottom tab bar from Mantine's
 * `sm` breakpoint up.
 */
export function TabBar({ items }: { items: NavItem[] }) {
  useNavHotkeys(items)
  const isWide = useMediaQuery('(min-width: 48em)')
  return isWide ? <FullTabBar items={items} /> : <GroupedTopBar items={items} />
}
