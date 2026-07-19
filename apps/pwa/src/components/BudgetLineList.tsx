import { useState } from 'react'
import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
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

/** One budget line's display card, with its normalized fortnightly amount and controls. */
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
    <Card withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={600}>{line.name}</Text>
            <Text size="sm" c="dimmed">
              {formatCents(line.amount_cents)}
            </Text>
          </Stack>
          <Stack gap={4} align="flex-end">
            <Badge variant="outline" tt="capitalize">
              {line.frequency}
            </Badge>
            <Text size="lg" fw={700}>
              {formatCents(fortnightly)}
            </Text>
            <Text size="xs" c="dimmed">
              per fortnight
            </Text>
          </Stack>
        </Group>
        <Group grow>
          <Button variant="light" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="subtle" color="red" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Stack>
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

  const startAdding = (group: BudgetGroup) => {
    setEditingId(null)
    setAddingGroup(group)
  }
  const startEditing = (id: string) => {
    setAddingGroup(null)
    setEditingId(id)
  }
  const closeForms = () => {
    setEditingId(null)
    setAddingGroup(null)
  }

  return (
    <Stack gap="xl">
      {BUDGET_GROUPS.map(({ value: group, label }) => {
        const groupLines = lines.filter((line) => line.line_group === group)
        const subtotal = groupLines.reduce(
          (total, line) => total + fortnightlyCents(line.amount_cents, line.frequency),
          0,
        )
        return (
          <Stack key={group} gap="sm">
            <Group justify="space-between" align="baseline" wrap="nowrap">
              <Title order={3}>{label}</Title>
              <Text fw={700} aria-label={`${label} fortnightly subtotal`}>
                {formatCents(subtotal)} / fn
              </Text>
            </Group>

            {groupLines.length === 0 && addingGroup !== group && (
              <Text c="dimmed" size="sm">
                No {label.toLowerCase()} lines yet.
              </Text>
            )}

            {groupLines.map((line) =>
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

            {addingGroup === group ? (
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
            )}
          </Stack>
        )
      })}
    </Stack>
  )
}
