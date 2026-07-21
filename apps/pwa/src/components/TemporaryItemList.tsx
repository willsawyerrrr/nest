import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import { isTemporaryActive } from '@nest/plan'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import { formatIsoDate } from '../lib/dates'
import { formatCents } from '../lib/money'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { GroupSection } from './GroupSection'
import { TemporaryItemForm } from './TemporaryItemForm'

interface TemporaryItemListProps {
  items: TemporaryItem[]
  /** Reference instant for the active/expired check; defaults to now. */
  now?: Date
  onCreate: (input: TemporaryItemInput) => Promise<void>
  onUpdate: (id: string, input: TemporaryItemInput) => Promise<void>
  onDelete: (id: string) => void
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
              until {formatIsoDate(item.target_date)}
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
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
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
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()

  const activeSubtotal = items.reduce(
    (total, item) =>
      isTemporaryActive({ contributionCents: 0, targetDate: item.target_date }, now)
        ? total + item.contribution_cents
        : total,
    0,
  )

  return (
    <GroupSection title="Temporary" subtotalCents={activeSubtotal}>
      {items.length === 0 && !adding && <EmptyState>No temporary lines yet.</EmptyState>}

      {items.map((item) =>
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
      )}

      {adding ? (
        <TemporaryItemForm
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <Button variant="light" fullWidth onClick={() => startAdding(true)}>
          Add Temporary line
        </Button>
      )}
    </GroupSection>
  )
}
