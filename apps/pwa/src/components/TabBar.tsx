/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { NavLink } from 'react-router-dom'
import { Text } from '@mantine/core'

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

/** Fixed bottom tab bar whose active tab tracks the current route. */
export function TabBar({ items }: { items: NavItem[] }) {
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
