import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLocalStorage, useMediaQuery } from '@mantine/hooks'
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  CloseButton,
  Flex,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { fortnightlyCents } from '@nest/plan'
import type { BudgetGroup, BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { accountLabel } from '../lib/accountName'
import { formatCents } from '../lib/money'
import { formatFrequency } from '../lib/frequency'
import { AccountIcon } from './AccountIcon'
import { BudgetLineForm } from './BudgetLineForm'
import { GroupSection } from './GroupSection'

interface BudgetLineListProps {
  lines: BudgetLine[]
  goals: { id: string; name: string; linkedAccountId?: string | null }[]
  /** The household's accounts, offered as the funding destination on non-savings/investments lines. */
  accounts?: { id: string; name: string }[]
  /** The household's total planned gift spend, driving any gift-derived line. */
  giftTotalCents?: number
  onCreate: (input: BudgetLineInput) => Promise<void>
  onUpdate: (id: string, input: BudgetLineInput) => Promise<void>
  onDelete: (id: string) => void
}

/** How the lines within each group are ordered. */
type SortKey = 'default' | 'name' | 'amount'

/** Which way a sorted order runs. */
type SortDirection = 'asc' | 'desc'

/** The persisted sort preference for the budget lines. */
interface SortPreference {
  key: SortKey
  direction: SortDirection
}

const SORT_STORAGE_KEY = 'budget-line-sort'
const DEFAULT_SORT: SortPreference = { key: 'default', direction: 'asc' }

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'name', label: 'Name' },
  { value: 'amount', label: 'Amount' },
]

/**
 * Orders lines by the chosen key and direction. `default` preserves the given
 * order untouched; `name` and `amount` sort ascending then reverse for descending.
 */
function sortLines(lines: BudgetLine[], key: SortKey, direction: SortDirection): BudgetLine[] {
  if (key === 'default') {
    return lines
  }
  const sorted = [...lines].sort((a, b) =>
    key === 'name'
      ? a.name.localeCompare(b.name)
      : fortnightlyCents(a.amount_cents, a.frequency, a.interval_weeks ?? undefined) -
        fortnightlyCents(b.amount_cents, b.frequency, b.interval_weeks ?? undefined),
  )
  return direction === 'desc' ? sorted.reverse() : sorted
}

/** A tappable badge linking a gift-derived line back to the gift tracker. */
function GiftBadge() {
  return (
    <Anchor component={Link} to="/gifts" underline="never">
      <Badge size="xs" variant="light" color="teal">
        from Gifts
      </Badge>
    </Anchor>
  )
}

/** Whether lines in a group route via a savings goal rather than a funding account. */
function groupLinksGoal(group: BudgetGroup): boolean {
  return group === 'savings' || group === 'investments'
}

/** Where a budget line sends its money, ready to render as a route badge. */
interface LineRoute {
  /** The account/saver name the icon is derived from. */
  iconName: string
  /** The route's emoji-stripped display text. */
  label: string
  /** The badge's hover text. */
  title: string
}

/**
 * The route a line displays: a Savings/Investments line names its linked goal,
 * iconed by the goal's linked saver; every other line names its funding account.
 * Undefined when the line is unrouted or the target is not in the supplied data.
 */
function resolveRoute(
  line: BudgetLine,
  goals: { id: string; name: string; linkedAccountId?: string | null }[],
  accountNames: Map<string, string>,
): LineRoute | undefined {
  if (groupLinksGoal(line.line_group)) {
    const goal = line.goal_id ? goals.find((g) => g.id === line.goal_id) : undefined
    if (!goal) {
      return undefined
    }
    const label = accountLabel(goal.name)
    const linkedName = goal.linkedAccountId ? accountNames.get(goal.linkedAccountId) : undefined
    return { iconName: linkedName ?? goal.name, label, title: `Goal: ${label}` }
  }
  const name = line.destination_account_id
    ? accountNames.get(line.destination_account_id)
    : undefined
  if (!name) {
    return undefined
  }
  const label = accountLabel(name)
  return { iconName: name, label, title: `Funded from ${label}` }
}

/** A subtle badge naming where a line routes: its linked goal or its funding account. */
function RouteBadge({ route }: { route: LineRoute }) {
  return (
    <Badge
      size="xs"
      variant="light"
      color="gray"
      leftSection={<AccountIcon name={route.iconName} size={10} />}
      title={route.title}
      style={{ maxWidth: '12rem' }}
    >
      {route.label}
    </Badge>
  )
}

/** The edit and delete controls shared by both the row and the card treatments. */
function LineActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <>
      <ActionIcon variant="subtle" aria-label="Edit" onClick={onEdit}>
        <IconPencil size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" color="red" aria-label="Delete" onClick={onDelete}>
        <IconTrash size={16} />
      </ActionIcon>
    </>
  )
}

/**
 * One budget line as a single dense table-like row for desktop: the name grows
 * to fill, with the amount, frequency, and fortnightly figure right-aligned in
 * fixed columns and the controls at the end, separated by a light rule rather
 * than a bordered card so many lines fit and scan as a table.
 */
function BudgetLineRow({
  line,
  route,
  onEdit,
  onDelete,
}: {
  line: BudgetLine
  route?: LineRoute
  onEdit: () => void
  onDelete: () => void
}) {
  const fortnightly = fortnightlyCents(
    line.amount_cents,
    line.frequency,
    line.interval_weeks ?? undefined,
  )
  const derived = line.derived_source === 'gift'
  return (
    <Group
      wrap="nowrap"
      gap="md"
      py={6}
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {line.name}
        </Text>
        {derived && <GiftBadge />}
        {route && <RouteBadge route={route} />}
      </Group>
      <Text size="sm" c="dimmed" ta="right" style={{ width: '6rem', flexShrink: 0 }}>
        {formatCents(line.amount_cents)}
      </Text>
      <Box style={{ width: '8rem', flexShrink: 0, textAlign: 'right' }}>
        <Badge size="sm" variant="light">
          {formatFrequency(line.frequency, line.interval_weeks)}
        </Badge>
      </Box>
      <Group
        gap={2}
        wrap="nowrap"
        justify="flex-end"
        align="baseline"
        style={{ width: '7rem', flexShrink: 0 }}
      >
        <Text fw={700} size="sm">
          {formatCents(fortnightly)}
        </Text>
        <Text size="xs" c="dimmed">
          / fn
        </Text>
      </Group>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <LineActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </Group>
  )
}

/** One budget line as a compact bordered card for mobile: name stacked over amount, frequency, and controls. */
function BudgetLineCard({
  line,
  route,
  onEdit,
  onDelete,
}: {
  line: BudgetLine
  route?: LineRoute
  onEdit: () => void
  onDelete: () => void
}) {
  const fortnightly = fortnightlyCents(
    line.amount_cents,
    line.frequency,
    line.interval_weeks ?? undefined,
  )
  const derived = line.derived_source === 'gift'
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {line.name}
          </Text>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {formatCents(line.amount_cents)}
            </Text>
            <Badge size="xs" variant="light">
              {formatFrequency(line.frequency, line.interval_weeks)}
            </Badge>
            {derived && <GiftBadge />}
            {route && <RouteBadge route={route} />}
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Group gap={2} wrap="nowrap" align="baseline">
            <Text fw={700} size="sm">
              {formatCents(fortnightly)}
            </Text>
            <Text size="xs" c="dimmed">
              / fn
            </Text>
          </Group>
          <LineActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </Card>
  )
}

/**
 * A single budget line, rendered as a dense table-like row from the `sm`
 * breakpoint up and as a compact bordered card below it.
 */
function BudgetLineItem(props: {
  line: BudgetLine
  route?: LineRoute
  onEdit: () => void
  onDelete: () => void
}) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <BudgetLineRow {...props} /> : <BudgetLineCard {...props} />
}

/**
 * The household's budget lines grouped by the five groups, each group showing a
 * fortnightly subtotal, a per-group add affordance, and inline add/edit forms.
 */
export function BudgetLineList({
  lines,
  goals,
  accounts = [],
  giftTotalCents = 0,
  onCreate,
  onUpdate,
  onDelete,
}: BudgetLineListProps) {
  // A household has a single gift-derived line, so the option is offered only
  // when no other line already derives from the gift tracker.
  const giftSourceAvailableFor = (id?: string) =>
    !lines.some((line) => line.derived_source === 'gift' && line.id !== id)
  // Account name lookup for each line's route badge and its icon.
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState<BudgetGroup | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useLocalStorage<SortPreference>({
    key: SORT_STORAGE_KEY,
    defaultValue: DEFAULT_SORT,
    getInitialValueInEffect: false,
  })
  const { key: sortKey, direction: sortDirection } = sort

  const startAdding = (group: BudgetGroup) => {
    setEditingId(null)
    setAddingItem(false)
    setAddingGroup(group)
  }
  const startEditing = (id: string) => {
    setAddingGroup(null)
    setAddingItem(false)
    setEditingId(id)
  }
  const startAddingItem = () => {
    setEditingId(null)
    setAddingGroup(null)
    setAddingItem(true)
  }
  const closeForms = () => {
    setEditingId(null)
    setAddingGroup(null)
    setAddingItem(false)
  }

  const search = query.trim().toLowerCase()
  const searching = search !== ''

  return (
    <Stack gap="lg">
      <Flex
        direction={{ base: 'column', sm: 'row' }}
        gap="sm"
        align={{ sm: 'flex-end' }}
        wrap="wrap"
      >
        <Button onClick={startAddingItem} style={{ flexShrink: 0 }}>
          Add item
        </Button>
        <TextInput
          aria-label="Search budget lines"
          placeholder="Search budget lines"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          rightSection={
            query ? <CloseButton aria-label="Clear search" onClick={() => setQuery('')} /> : null
          }
          style={{ flexGrow: 1 }}
        />
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label="Sort by"
            data={SORT_OPTIONS}
            value={sortKey}
            onChange={(value) =>
              value && setSort((current) => ({ ...current, key: value as SortKey }))
            }
            allowDeselect={false}
          />
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle sort direction"
            onClick={() =>
              setSort((current) => ({
                ...current,
                direction: current.direction === 'asc' ? 'desc' : 'asc',
              }))
            }
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </ActionIcon>
        </Group>
      </Flex>

      {addingItem && (
        <BudgetLineForm
          goals={goals}
          accounts={accounts}
          giftTotalCents={giftTotalCents}
          giftSourceAvailable={giftSourceAvailableFor()}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      )}

      {BUDGET_GROUPS.map(({ value: group, label }) => {
        const groupLines = lines.filter((line) => line.line_group === group)
        const subtotal = groupLines.reduce(
          (total, line) =>
            total +
            fortnightlyCents(line.amount_cents, line.frequency, line.interval_weeks ?? undefined),
          0,
        )
        const visibleLines = sortLines(
          searching
            ? groupLines.filter((line) => line.name.toLowerCase().includes(search))
            : groupLines,
          sortKey,
          sortDirection,
        )
        if (searching && visibleLines.length === 0) {
          return null
        }
        return (
          <GroupSection key={group} title={label} subtotalCents={subtotal}>
            {!searching && groupLines.length === 0 && addingGroup !== group && (
              <Text c="dimmed" size="sm">
                No {label.toLowerCase()} lines yet.
              </Text>
            )}

            {visibleLines.map((line) =>
              editingId === line.id ? (
                <BudgetLineForm
                  key={line.id}
                  initial={line}
                  goals={goals}
                  accounts={accounts}
                  giftTotalCents={giftTotalCents}
                  giftSourceAvailable={giftSourceAvailableFor(line.id)}
                  onSubmit={async (input) => {
                    await onUpdate(line.id, input)
                    closeForms()
                  }}
                  onCancel={closeForms}
                />
              ) : (
                <BudgetLineItem
                  key={line.id}
                  line={line}
                  route={resolveRoute(line, goals, accountNames)}
                  onEdit={() => startEditing(line.id)}
                  onDelete={() => onDelete(line.id)}
                />
              ),
            )}

            {!searching &&
              (addingGroup === group ? (
                <BudgetLineForm
                  defaultGroup={group}
                  goals={goals}
                  accounts={accounts}
                  giftTotalCents={giftTotalCents}
                  giftSourceAvailable={giftSourceAvailableFor()}
                  onSubmit={async (input) => {
                    await onCreate(input)
                    closeForms()
                  }}
                  onCancel={closeForms}
                />
              ) : (
                <Button variant="light" fullWidth onClick={() => startAdding(group)}>
                  Add {label} line
                </Button>
              ))}
          </GroupSection>
        )
      })}
    </Stack>
  )
}
