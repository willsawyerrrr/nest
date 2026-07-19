/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Text, UnstyledButton } from '@mantine/core'
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

/** A named section of the bottom bar, resolved to the nav items it fronts. */
export type NavGroup = { label: string; items: NavItem[] }

/**
 * Section labels over nav-item paths, in display order. The grouped bottom bar
 * is built from this table so a new tab slots into a group by listing its path.
 */
export const NAV_GROUPING: { label: string; paths: string[] }[] = [
  { label: 'Overview', paths: ['/summary'] },
  { label: 'Money', paths: ['/inflows'] },
  { label: 'Plan', paths: ['/budget', '/goals'] },
  { label: 'Settings', paths: ['/tax', '/household'] },
]

/** Resolves `grouping` against `items`, dropping paths with no matching item. */
export function buildNavGroups(items: NavItem[], grouping = NAV_GROUPING): NavGroup[] {
  const byPath = new Map(items.map((item) => [item.path, item]))
  return grouping.map((group) => ({
    label: group.label,
    items: group.paths
      .map((path) => byPath.get(path))
      .filter((item): item is NavItem => item !== undefined),
  }))
}

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
            {({ isActive }) => <NavLabel label={item.label} active={isActive} />}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** Bottom-bar label, bold and tinted while its target (or group) is active. */
function NavLabel({ label, active }: { label: string; active: boolean }) {
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
 * Fixed bottom bar that collapses the tabs into `NAV_GROUPING` sections. A
 * single-item group navigates straight to its route; a multi-item group opens a
 * menu to pick the destination. The group holding the current route is
 * highlighted. Hotkeys and cycling stay owned by {@link TabBar}, which is
 * mounted alongside this variant, so both bars share one set of shortcuts.
 */
export function GroupedTabBar({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation()
  const groups = buildNavGroups(items)

  return (
    <nav className="tab-bar" aria-label="Primary">
      <div className="tab-bar__list">
        {groups.map((group) => {
          const [only] = group.items
          return group.items.length === 1 && only ? (
            <NavLink key={group.label} to={only.path} className="tab-bar__tab">
              {({ isActive }) => <NavLabel label={group.label} active={isActive} />}
            </NavLink>
          ) : (
            <NavGroupMenu key={group.label} group={group} pathname={pathname} />
          )
        })}
      </div>
    </nav>
  )
}

/** A multi-item section: a toggle that opens a menu of its destinations. */
function NavGroupMenu({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [opened, setOpened] = useState(false)
  const active = tabIndexForPath(group.items, pathname) !== -1
  const menuId = `nav-group-${group.label.toLowerCase()}`

  return (
    <Menu opened={opened} onChange={setOpened} position="top" withinPortal>
      <Menu.Target>
        <UnstyledButton
          className="tab-bar__tab"
          aria-label={group.label}
          aria-haspopup="menu"
          aria-expanded={opened}
          aria-controls={menuId}
        >
          <NavLabel label={group.label} active={active} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown id={menuId}>
        {group.items.map((item) => (
          <Menu.Item key={item.path} component={NavLink} to={item.path}>
            {item.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
