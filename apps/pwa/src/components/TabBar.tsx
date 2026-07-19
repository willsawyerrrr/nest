/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
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

/** How many tabs sit directly in the mobile bar before the "More" overflow. */
const MOBILE_TAB_COUNT = 4

/** Id linking the "More" toggle to the overflow sheet it controls. */
const MORE_SHEET_ID = 'nav-more-sheet'

/** Wraps `index` into `[0, length)`, cycling past either end. */
export function cycleIndex(index: number, length: number) {
  return ((index % length) + length) % length
}

/** Index of the tab whose route `pathname` sits under, or `-1` if none. */
export function tabIndexForPath(items: NavItem[], pathname: string) {
  return items.findIndex((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

/** A single tab: a `NavLink` styled to track its own active state. */
function TabLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink key={item.path} to={item.path} className="tab-bar__tab" onClick={onNavigate}>
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

/** Fixed bottom tab bar whose active tab tracks the current route. */
export function TabBar({ items }: { items: NavItem[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const currentIndex = tabIndexForPath(items, pathname)

  // The bottom bar collapses its tail into a "More" sheet on phones, but keeps
  // the full horizontal row from `sm` up. Mirrors `SummaryView`'s breakpoint.
  const isDesktop = useMediaQuery('(min-width: 48em)')
  const [moreOpened, more] = useDisclosure(false)

  const primaryItems = items.slice(0, MOBILE_TAB_COUNT)
  const overflowItems = items.slice(MOBILE_TAB_COUNT)
  const hasOverflow = overflowItems.length > 0
  // The active route living in the overflow tail marks the "More" toggle active.
  const moreActive = currentIndex >= MOBILE_TAB_COUNT

  /** Navigates `offset` tabs away from the current one, wrapping at the ends. */
  const cycleTo = (offset: number) => {
    const next = items[cycleIndex(currentIndex + offset, items.length)]
    if (next) navigate(next.path)
  }

  // `mod+1`…`mod+N` jump to a tab by position; `mod+shift+Arrow` cycles with
  // wrap-around. Hotkeys cover every item, including those tucked inside "More",
  // so the tail stays reachable without opening the sheet. `Ctrl+Tab` is
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

  if (isDesktop || !hasOverflow) {
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

  return (
    <nav className="tab-bar" aria-label="Primary">
      <div className="tab-bar__list">
        {primaryItems.map((item) => (
          <TabLink key={item.path} item={item} />
        ))}
        <button
          type="button"
          className="tab-bar__tab tab-bar__more"
          aria-haspopup="menu"
          aria-expanded={moreOpened}
          aria-controls={MORE_SHEET_ID}
          aria-label="More navigation"
          aria-current={moreActive ? 'page' : undefined}
          onClick={more.toggle}
        >
          <Text
            size="sm"
            fw={moreActive ? 700 : 500}
            c={moreActive ? 'var(--mantine-primary-color-filled)' : 'dimmed'}
          >
            More
          </Text>
        </button>
      </div>
      <Drawer
        id={MORE_SHEET_ID}
        opened={moreOpened}
        onClose={more.close}
        position="bottom"
        size="auto"
        title="More"
      >
        <Stack gap={0}>
          {overflowItems.map((item) => (
            <TabLink key={item.path} item={item} onNavigate={more.close} />
          ))}
        </Stack>
      </Drawer>
    </nav>
  )
}
