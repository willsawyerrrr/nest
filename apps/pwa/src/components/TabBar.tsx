/* eslint-disable react/only-export-components -- co-locate the nav item table with the tab bar that renders it. */
import { useEffect, useId, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Box, Burger, Collapse, Drawer, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useDisclosure, useHotkeys, type HotkeyItem } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { ColorSchemeToggle } from './ColorSchemeToggle'
import { Logo } from './Logo'

export type NavItem = { path: string; label: string }

/** A collapsible run of nav items under a shared heading. */
export type NavGroup = { label: string; items: NavItem[] }

/** One entry in the nav: a standalone item, or a group of them. */
export type NavSection = NavItem | NavGroup

/**
 * Primary navigation, in display order: Summary stands alone as the landing
 * tab, and every other route sits in the group that describes what it is for.
 * Grouping is presentation only — each item keeps its own top-level route, so
 * every URL stays deep-linkable exactly as it is typed here.
 */
export const NAV_SECTIONS: NavSection[] = [
  { path: '/summary', label: 'Summary' },
  {
    label: 'Plan',
    items: [
      { path: '/inflows', label: 'Inflows' },
      { path: '/budget', label: 'Budget' },
      { path: '/breakdowns', label: 'Breakdowns' },
      { path: '/gifts', label: 'Gifts' },
      { path: '/splits', label: 'Pay splits' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { path: '/net-worth', label: 'Net worth' },
      { path: '/goals', label: 'Goals' },
      { path: '/super', label: 'Super' },
      { path: '/equity', label: 'Equity' },
    ],
  },
  {
    label: 'Tax',
    items: [
      { path: '/tax', label: 'Estimate' },
      { path: '/payslips', label: 'Payslips' },
      { path: '/deductions', label: 'Deductions' },
      { path: '/help-debt', label: 'HELP debt' },
      { path: '/eofy', label: 'EOFY' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/household', label: 'Household' },
      { path: '/whats-new', label: "What's new" },
    ],
  },
]

/** The Planning tab, shown in the nav only while planning mode is on. */
export const PLANNING_NAV_ITEM: NavItem = { path: '/planning', label: 'Planning' }

/**
 * The nav sections for the current planning-mode state: the standing sections,
 * with the Planning tab spliced in beside Summary while the sandbox is on so it
 * is reachable without the banner.
 */
export function navSections(planningActive: boolean): NavSection[] {
  if (!planningActive) {
    return NAV_SECTIONS
  }
  // Spliced in right after Summary (the first entry), so it sits beside it.
  return NAV_SECTIONS.flatMap((section, index) =>
    index === 0 ? [section, PLANNING_NAV_ITEM] : [section],
  )
}

/** Whether `section` gathers items rather than being one itself. */
export function isNavGroup(section: NavSection): section is NavGroup {
  return 'items' in section
}

/** Every nav item in display order, each group's items spliced in place. */
export function flattenNavItems(sections: NavSection[]): NavItem[] {
  return sections.flatMap((section) => (isNavGroup(section) ? section.items : section))
}

/** Wraps `index` into `[0, length)`, cycling past either end. */
export function cycleIndex(index: number, length: number) {
  return ((index % length) + length) % length
}

/** Index of the tab whose route `pathname` sits under, or `-1` if none. */
function tabIndexForPath(items: NavItem[], pathname: string) {
  return items.findIndex((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

/** Label of the group holding `pathname`, or `undefined` when none does. */
function activeGroupLabel(sections: NavSection[], pathname: string) {
  return sections.find(
    (section) => isNavGroup(section) && tabIndexForPath(section.items, pathname) !== -1,
  )?.label
}

const DRAWER_ID = 'primary-nav-drawer'

/** One nav destination, highlighted while its route is the current one. */
function NavItemLink({
  item,
  onNavigate,
}: {
  item: NavItem
  onNavigate: (() => void) | undefined
}) {
  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={({ isActive }) =>
        isActive ? 'drawer-nav__link drawer-nav__link--active' : 'drawer-nav__link'
      }
    >
      {({ isActive }) => (
        <Text
          size="md"
          fw={isActive ? 700 : 500}
          // The active label adapts by scheme: a deep brand shade that clears
          // WCAG AA on the pale light wash, and the vivid lime on the dark
          // canvas where it already reads. The lime left-edge bar and wash
          // stay lime in both schemes.
          {...(isActive && {
            c: 'light-dark(var(--mantine-color-brand-9), var(--mantine-color-brand-5))',
          })}
        >
          {item.label}
        </Text>
      )}
    </NavLink>
  )
}

/**
 * A nav group: a full-width header button that folds its items away, over the
 * items themselves. The header is a quiet label rather than a destination, and
 * carries a lime dot while collapsed over the current route so a folded section
 * still shows it holds the page you are on.
 */
function NavGroupSection({
  group,
  listId,
  opened,
  holdsActiveRoute,
  onToggle,
  onNavigate,
}: {
  group: NavGroup
  listId: string
  opened: boolean
  holdsActiveRoute: boolean
  onToggle: () => void
  onNavigate: (() => void) | undefined
}) {
  return (
    <Box>
      <UnstyledButton
        className="drawer-nav__group"
        onClick={onToggle}
        aria-expanded={opened}
        aria-controls={listId}
        // Folded over the current route, the header stands in for the active
        // item its list has hidden — marked for a screen reader, dotted for an eye.
        aria-current={!opened && holdsActiveRoute ? 'true' : undefined}
      >
        <Group gap="xxs" wrap="nowrap">
          {opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          {/*
           * One size below the items it heads, so the label sits close enough to
           * read as part of the same list while staying subordinate to them —
           * the uppercase casing, tracking, and dimmed colour carry the rest of
           * the distinction, leaving size to do only part of the work.
           */}
          <Text size="sm" fw={700} tt="uppercase" c="dimmed" className="drawer-nav__group-label">
            {group.label}
          </Text>
          {!opened && holdsActiveRoute && <Box className="drawer-nav__group-dot" aria-hidden />}
        </Group>
      </UnstyledButton>

      <Collapse expanded={opened} id={listId}>
        <Stack gap="xxs" pt="xxs" className="drawer-nav__group-items">
          {group.items.map((item) => (
            <NavItemLink key={item.path} item={item} onNavigate={onNavigate} />
          ))}
        </Stack>
      </Collapse>
    </Box>
  )
}

/**
 * Vertical list of every nav section as a labelled `nav` landmark. The mobile
 * drawer and the desktop sidebar both render it, so the two variants share one
 * item style, active-highlight treatment, and set of groups. `onNavigate` fires
 * after a tab is chosen, letting the drawer close itself on selection.
 */
function NavList({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const baseId = useId()
  const activeLabel = activeGroupLabel(sections, pathname)
  const [openLabels, setOpenLabels] = useState<string[]>(() => (activeLabel ? [activeLabel] : []))

  // The route sets the default: the group holding the current page opens and
  // the rest fold away, on mount and on every navigation — including one a
  // keyboard shortcut makes into a collapsed group. Between navigations a
  // header toggle stands, so opening a second group by hand leaves both open.
  useEffect(() => {
    setOpenLabels(activeLabel ? [activeLabel] : [])
  }, [pathname, activeLabel])

  const toggle = (label: string) =>
    setOpenLabels((open) =>
      open.includes(label) ? open.filter((each) => each !== label) : [...open, label],
    )

  return (
    <Stack gap="xxs" component="nav" aria-label="Primary">
      {sections.map((section) =>
        isNavGroup(section) ? (
          <NavGroupSection
            key={section.label}
            group={section}
            listId={`${baseId}-${section.label.toLowerCase()}`}
            opened={openLabels.includes(section.label)}
            holdsActiveRoute={activeLabel === section.label}
            onToggle={() => toggle(section.label)}
            onNavigate={onNavigate}
          />
        ) : (
          <NavItemLink key={section.path} item={section} onNavigate={onNavigate} />
        ),
      )}
    </Stack>
  )
}

/**
 * Route-aware primary navigation. On mobile it is a fixed top bar with a
 * hamburger that opens a drawer of every nav section; on desktop (`sm` and up)
 * it is a persistent left sidebar listing the same sections. Both variants stay
 * driven by `sections`, so a new tab or group appears everywhere at once.
 */
export function TabBar({ sections }: { sections: NavSection[] }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const items = flattenNavItems(sections)
  const currentIndex = tabIndexForPath(items, pathname)
  const [drawerOpened, drawer] = useDisclosure(false)

  /** Navigates `offset` tabs away from the current one, wrapping at the ends. */
  const cycleTo = (offset: number) => {
    const next = items[cycleIndex(currentIndex + offset, items.length)]
    if (next) navigate(next.path)
  }

  // `mod+1`…`mod+N` jump to a tab by position in the flattened order and
  // `mod+shift+Arrow` cycles it with wrap-around, both reaching straight into a
  // collapsed group: the route change that follows opens the group it lands in.
  // `Ctrl+Tab` is avoided: browsers reserve it for their own tab switching and
  // JS cannot reliably intercept it. `useHotkeys` ignores events from
  // `input`/`textarea`/`select`/contentEditable by default, so shortcuts stay
  // dormant while typing. Shortcuts are wired once and drive both variants.
  const hotkeys: HotkeyItem[] = [
    ...items.map((item, index): HotkeyItem => [`mod+${index + 1}`, () => navigate(item.path)]),
    ['mod+shift+ArrowRight', () => cycleTo(1)],
    ['mod+shift+ArrowLeft', () => cycleTo(-1)],
  ]
  useHotkeys(hotkeys)

  return (
    <>
      <Box component="header" className="top-bar" hiddenFrom="sm">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Logo variant="mark" size={28} />
          <Group gap="xs" wrap="nowrap">
            <ColorSchemeToggle />
            <Burger
              opened={drawerOpened}
              onClick={drawer.toggle}
              size="sm"
              aria-label="Toggle navigation menu"
              aria-expanded={drawerOpened}
              aria-controls={DRAWER_ID}
            />
          </Group>
        </Group>
      </Box>

      <Drawer
        id={DRAWER_ID}
        opened={drawerOpened}
        onClose={drawer.close}
        position="left"
        size="xs"
        title={<Logo variant="mark" size={28} />}
        hiddenFrom="sm"
        classNames={{ header: 'drawer-nav__header', body: 'drawer-nav__body' }}
      >
        <NavList sections={sections} onNavigate={drawer.close} />
      </Drawer>

      <Box component="aside" className="sidebar" visibleFrom="sm">
        <Box mb="lg" px="xs">
          <Logo variant="lockup" size={32} />
        </Box>
        <Box style={{ flex: 1 }}>
          <NavList sections={sections} />
        </Box>
        <Group className="sidebar__footer" justify="flex-end" px="xs" pt="sm">
          <ColorSchemeToggle />
        </Group>
      </Box>
    </>
  )
}
