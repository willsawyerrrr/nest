import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMediaQuery } from '@mantine/hooks'
import {
  ActionIcon,
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
import { IconChevronRight, IconPencil } from '@tabler/icons-react'
import { fortnightlyCents } from '@nest/plan'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import type { BudgetGroup } from '../lib/domain'
import { useInlineEditing } from '../hooks/useInlineEditing'
import { useSortPreference } from '../hooks/useSortPreference'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { accountLabel } from '../lib/accountName'
import { formatCents } from '../lib/money'
import { formatFrequency } from '../lib/frequency'
import { sortBy, type SortDirection, type SortPreference } from '../lib/sort'
import { AccountIcon } from './AccountIcon'
import { BudgetLineForm } from './BudgetLineForm'
import { DerivedBudgetLineForm, type DerivedLineValues } from './DerivedBudgetLineForm'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { FortnightlyAmount } from './FortnightlyAmount'
import { GroupSection } from './GroupSection'

interface BudgetLineListProps {
  lines: BudgetLine[]
  goals: { id: string; name: string; linkedAccountId?: string | null }[]
  /** The household's accounts, offered as the funding destination on non-savings/investments lines. */
  accounts?: { id: string; name: string }[]
  /** The household's breakdowns; a line sourced from one links through to it and seeds its editor. */
  breakdowns?: { id: string; name: string; line_group: BudgetGroup }[]
  onCreate: (input: BudgetLineInput) => Promise<void>
  onUpdate: (id: string, input: BudgetLineInput) => Promise<void>
  /** Saves a derived line's edit, fanning the name/group to its breakdown and the funding account to the line. */
  onUpdateDerivedLine?: (lineId: string, values: DerivedLineValues) => Promise<void>
  onDelete: (id: string) => void
}

/** Which add form is open: the top-level item form, or a per-group line form. */
type AddContext = { kind: 'item' } | { kind: 'group'; group: BudgetGroup }

/** How the lines within each group are ordered. */
type SortKey = 'default' | 'name' | 'amount'

const SORT_STORAGE_KEY = 'budget-line-sort'
const DEFAULT_SORT: SortPreference<SortKey> = { key: 'default', direction: 'asc' }

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
  return sortBy(
    lines,
    (a, b) =>
      key === 'name'
        ? a.name.localeCompare(b.name)
        : fortnightlyCents(a.amount_cents, a.frequency, a.interval_weeks ?? undefined) -
          fortnightlyCents(b.amount_cents, b.frequency, b.interval_weeks ?? undefined),
    direction,
  )
}

/** A chevron control linking a derived line through to its breakdown's editor. */
function BreakdownLink({ id }: { id: string }) {
  return (
    <ActionIcon
      component={Link}
      to={`/breakdowns/${id}`}
      state={{ from: '/budget' }}
      variant="subtle"
      aria-label="Open breakdown"
    >
      <IconChevronRight size={16} />
    </ActionIcon>
  )
}

/** A derived line's controls: an inline edit pencil beside the chevron to its breakdown. */
function DerivedLineControls({
  breakdownId,
  onEdit,
}: {
  breakdownId: string
  onEdit?: () => void
}) {
  return (
    <>
      {onEdit && (
        <ActionIcon variant="subtle" aria-label="Edit" onClick={onEdit}>
          <IconPencil size={16} />
        </ActionIcon>
      )}
      <BreakdownLink id={breakdownId} />
    </>
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

/**
 * One budget line as a single dense table-like row for desktop: the name grows
 * to fill, with the amount, frequency, and fortnightly figure right-aligned in
 * fixed columns and the controls at the end, separated by a light rule rather
 * than a bordered card so many lines fit and scan as a table. A derived line
 * shows an edit pencil and its breakdown chevron in place of the edit/delete controls.
 */
function BudgetLineRow({
  line,
  route,
  breakdown,
  onEdit,
  onDelete,
}: {
  line: BudgetLine
  route?: LineRoute
  breakdown?: { id: string }
  onEdit?: () => void
  onDelete?: () => void
}) {
  const fortnightly = fortnightlyCents(
    line.amount_cents,
    line.frequency,
    line.interval_weeks ?? undefined,
  )
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
      <FortnightlyAmount
        cents={fortnightly}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap={4} wrap="nowrap" justify="flex-end" style={{ width: '3.75rem', flexShrink: 0 }}>
        {breakdown ? (
          <DerivedLineControls breakdownId={breakdown.id} onEdit={onEdit} />
        ) : (
          onEdit && onDelete && <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        )}
      </Group>
    </Group>
  )
}

/**
 * One budget line as a compact bordered card for mobile: name stacked over
 * amount, frequency, and controls. A derived line shows an edit pencil and its
 * breakdown chevron in place of the edit/delete controls.
 */
function BudgetLineCard({
  line,
  route,
  breakdown,
  onEdit,
  onDelete,
}: {
  line: BudgetLine
  route?: LineRoute
  breakdown?: { id: string }
  onEdit?: () => void
  onDelete?: () => void
}) {
  const fortnightly = fortnightlyCents(
    line.amount_cents,
    line.frequency,
    line.interval_weeks ?? undefined,
  )
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
            {route && <RouteBadge route={route} />}
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <FortnightlyAmount cents={fortnightly} />
          {breakdown ? (
            <DerivedLineControls breakdownId={breakdown.id} onEdit={onEdit} />
          ) : (
            onEdit && onDelete && <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          )}
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
  breakdown?: { id: string }
  onEdit?: () => void
  onDelete?: () => void
}) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <BudgetLineRow {...props} /> : <BudgetLineCard {...props} />
}

/**
 * The household's budget lines grouped by the five groups, each group showing a
 * fortnightly subtotal, a per-group add affordance, and inline add/edit forms.
 * A derived line (one owned by a breakdown) edits inline like a manual line —
 * its name and group flow to the breakdown and its funding account to the line —
 * but its amount stays breakdown-owned, so it carries an edit pencil and a
 * chevron to its breakdown rather than a delete control.
 */
export function BudgetLineList({
  lines,
  goals,
  accounts = [],
  breakdowns = [],
  onCreate,
  onUpdate,
  onUpdateDerivedLine,
  onDelete,
}: BudgetLineListProps) {
  // Account name lookup for each line's route badge and its icon.
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
  const breakdownsById = new Map(breakdowns.map((breakdown) => [breakdown.id, breakdown]))
  const {
    editingId,
    adding,
    startAdding: startAddingContext,
    startEditing,
    close: closeForms,
  } = useInlineEditing<AddContext>()
  const addingItem = adding?.kind === 'item'
  const addingGroup = adding?.kind === 'group' ? adding.group : null
  const [query, setQuery] = useState('')
  const {
    key: sortKey,
    direction: sortDirection,
    setKey,
    toggleDirection,
  } = useSortPreference(SORT_STORAGE_KEY, DEFAULT_SORT)

  const startAdding = (group: BudgetGroup) => startAddingContext({ kind: 'group', group })
  const startAddingItem = () => startAddingContext({ kind: 'item' })

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
            onChange={(value) => value && setKey(value as SortKey)}
            allowDeselect={false}
          />
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle sort direction"
            onClick={toggleDirection}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </ActionIcon>
        </Group>
      </Flex>

      {addingItem && (
        <BudgetLineForm
          goals={goals}
          accounts={accounts}
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
              <EmptyState>No {label.toLowerCase()} lines yet.</EmptyState>
            )}

            {visibleLines.map((line) => {
              const breakdown = line.breakdown_id
                ? breakdownsById.get(line.breakdown_id)
                : undefined
              // A derived line edits inline: its name and group flow to the
              // breakdown and its funding account to the line, while its amount
              // stays owned by the breakdown.
              if (breakdown) {
                return editingId === line.id && onUpdateDerivedLine ? (
                  <DerivedBudgetLineForm
                    key={line.id}
                    initial={{
                      id: line.id,
                      breakdown_id: breakdown.id,
                      name: breakdown.name,
                      line_group: breakdown.line_group,
                      destination_account_id: line.destination_account_id,
                      amount_cents: line.amount_cents,
                      frequency: line.frequency,
                      interval_weeks: line.interval_weeks,
                    }}
                    accounts={accounts}
                    onSave={async (values) => {
                      await onUpdateDerivedLine(line.id, values)
                      closeForms()
                    }}
                    onCancel={closeForms}
                  />
                ) : (
                  <BudgetLineItem
                    key={line.id}
                    line={line}
                    route={resolveRoute(line, goals, accountNames)}
                    breakdown={breakdown}
                    onEdit={onUpdateDerivedLine ? () => startEditing(line.id) : undefined}
                  />
                )
              }
              return editingId === line.id ? (
                <BudgetLineForm
                  key={line.id}
                  initial={line}
                  goals={goals}
                  accounts={accounts}
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
              )
            })}

            {!searching &&
              (addingGroup === group ? (
                <BudgetLineForm
                  defaultGroup={group}
                  goals={goals}
                  accounts={accounts}
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
