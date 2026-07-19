import { useState } from 'react'
import { ActionIcon, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { isTemporaryActive } from '@budget/plan'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import { formatCents } from '../lib/money'
import { TemporaryItemForm } from './TemporaryItemForm'

interface TemporaryItemListProps {
  items: TemporaryItem[]
  /** Reference instant for the active/expired check; defaults to now. */
  now?: Date
  onCreate: (input: TemporaryItemInput) => Promise<void>
  onUpdate: (id: string, input: TemporaryItemInput) => Promise<void>
  onDelete: (id: string) => void
}

/** Formats an ISO date (`YYYY-MM-DD`) as e.g. `3 Aug 2027`. */
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** One temporary item's display card, with its active/expired state and controls. */
function TemporaryItemCard({
  item,
  now,
  onEdit,
  onDelete,
}: {
  item: TemporaryItem
  now: Date
  onEdit: () => void
  onDelete: () => void
}) {
  const active = isTemporaryActive({ contributionCents: 0, targetDate: item.target_date }, now)
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {item.name}
          </Text>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="dimmed">
              until {formatDate(item.target_date)}
            </Text>
            <Badge size="xs" variant="light" color={active ? 'teal' : 'gray'}>
              {active ? 'Active' : 'Expired'}
            </Badge>
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text fw={700} size="sm">
            {formatCents(item.contribution_cents)}
          </Text>
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

/** The household's temporary items with an add affordance and inline add/edit forms. */
export function TemporaryItemList({
  items,
  now = new Date(),
  onCreate,
  onUpdate,
  onDelete,
}: TemporaryItemListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const startAdding = () => {
    setEditingId(null)
    setAdding(true)
  }
  const startEditing = (id: string) => {
    setAdding(false)
    setEditingId(id)
  }
  const closeForms = () => {
    setEditingId(null)
    setAdding(false)
  }

  return (
    <Stack gap="sm">
      {adding ? (
        <TemporaryItemForm
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <Button fullWidth onClick={startAdding}>
          Add temporary item
        </Button>
      )}

      {items.length === 0 && !adding ? (
        <Text c="dimmed" ta="center">
          No temporary items yet.
        </Text>
      ) : (
        items.map((item) =>
          editingId === item.id ? (
            <TemporaryItemForm
              key={item.id}
              initial={item}
              onSubmit={async (input) => {
                await onUpdate(item.id, input)
                closeForms()
              }}
              onCancel={closeForms}
            />
          ) : (
            <TemporaryItemCard
              key={item.id}
              item={item}
              now={now}
              onEdit={() => startEditing(item.id)}
              onDelete={() => onDelete(item.id)}
            />
          ),
        )
      )}
    </Stack>
  )
}
