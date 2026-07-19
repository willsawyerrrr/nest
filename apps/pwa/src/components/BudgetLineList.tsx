import { useState } from 'react'
import {
  ActionIcon,
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
  Title,
} from '@mantine/core'
import { fortnightlyCents } from '@budget/plan'
import type { BudgetGroup, BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { formatCents } from '../lib/money'
import { BudgetLineForm } from './BudgetLineForm'

interface BudgetLineListProps {
  lines: BudgetLine[]
  goals: { id: string; name: string }[]
  onCreate: (input: BudgetLineInput) => Promise<void>
  onUpdate: (id: string, input: BudgetLineInput) => Promise<void>
  onDelete: (id: string) => void
}

/** How the lines within each group are ordered. */
type SortKey = 'default' | 'name' | 'amount'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'name', label: 'Name' },
  { value: 'amount', label: 'Amount' },
]

/**
 * Orders lines by the chosen key and direction. `default` preserves the given
 * order untouched; `name` and `amount` sort ascending then reverse for descending.
 */
function sortLines(lines: BudgetLine[], key: SortKey, direction: 'asc' | 'desc'): BudgetLine[] {
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
            <Badge size="xs" variant="light" tt="capitalize">
              {line.frequency}
            </Badge>
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text fw={700} size="sm">
            {formatCents(fortnightly)}
          </Text>
          <Button variant="subtle" size="compact-xs" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="subtle" color="red" size="compact-xs" onClick={onDelete}>
            Delete
          </Button>
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
  onCreate,
  onUpdate,
  onDelete,
}: BudgetLineListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState<BudgetGroup | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

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
            onChange={(value) => value && setSortKey(value as SortKey)}
            allowDeselect={false}
          />
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle sort direction"
            onClick={() => setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </ActionIcon>
        </Group>
      </Flex>

      {addingItem && (
        <BudgetLineForm
          goals={goals}
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
          <Stack key={group} gap="xs">
            <Group justify="space-between" align="baseline" wrap="nowrap">
              <Title order={3}>{label}</Title>
              <Text fw={700} aria-label={`${label} fortnightly subtotal`}>
                {formatCents(subtotal)} / fn
              </Text>
            </Group>

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
          </Stack>
        )
      })}
    </Stack>
  )
}
