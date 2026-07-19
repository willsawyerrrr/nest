import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLocalStorage } from '@mantine/hooks'
import {
  ActionIcon,
  Anchor,
  Badge,
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
import { fortnightlyCents } from '@budget/plan'
import type { BudgetGroup, BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { formatCents } from '../lib/money'
import { formatFrequency } from '../lib/frequency'
import { BudgetLineForm } from './BudgetLineForm'
import { GroupSection } from './GroupSection'

interface BudgetLineListProps {
  lines: BudgetLine[]
  goals: { id: string; name: string }[]
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
      : fortnightlyCents(a.amount_cents, a.frequency) -
        fortnightlyCents(b.amount_cents, b.frequency),
  )
  return direction === 'desc' ? sorted.reverse() : sorted
}

/** One budget line as a compact single row: name, amount, frequency, fortnightly amount, controls. */
function BudgetLineCard({
  line,
  onEdit,
  onDelete,
}: {
  line: BudgetLine
  onEdit: () => void
  onDelete: () => void
}) {
  const fortnightly = fortnightlyCents(line.amount_cents, line.frequency)
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
              {formatFrequency(line.frequency)}
            </Badge>
            {derived && (
              <Anchor component={Link} to="/gifts" underline="never">
                <Badge size="xs" variant="light" color="grape">
                  from Gifts
                </Badge>
              </Anchor>
            )}
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
          <ActionIcon variant="subtle" aria-label="Edit" onClick={onEdit}>
            <IconPencil size={16} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="red" aria-label="Delete" onClick={onDelete}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Group>
    </Card>
  )
}

/**
 * The household's budget lines grouped by the five groups, each group showing a
 * fortnightly subtotal, a per-group add affordance, and inline add/edit forms.
 */
export function BudgetLineList({
  lines,
  goals,
  giftTotalCents = 0,
  onCreate,
  onUpdate,
  onDelete,
}: BudgetLineListProps) {
  // A household has a single gift-derived line, so the option is offered only
  // when no other line already derives from the gift tracker.
  const giftSourceAvailableFor = (id?: string) =>
    !lines.some((line) => line.derived_source === 'gift' && line.id !== id)
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
          (total, line) => total + fortnightlyCents(line.amount_cents, line.frequency),
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
                  giftTotalCents={giftTotalCents}
                  giftSourceAvailable={giftSourceAvailableFor(line.id)}
                  onSubmit={async (input) => {
                    await onUpdate(line.id, input)
                    closeForms()
                  }}
                  onCancel={closeForms}
                />
              ) : (
                <BudgetLineCard
                  key={line.id}
                  line={line}
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
