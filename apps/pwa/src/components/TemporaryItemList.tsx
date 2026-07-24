import { Badge, Group, Stack, Text } from '@mantine/core'
import { isTemporaryActive } from '@nest/plan'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { useInlineEditing } from '../hooks/useInlineEditing'
import { useIsWide } from '../hooks/useIsWide'
import type { TemporaryItem, TemporaryItemInput } from '../hooks/useTemporaryItems'
import { formatIsoDate } from '../lib/dates'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { GroupSection } from './GroupSection'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { TemporaryItemForm } from './TemporaryItemForm'

interface TemporaryItemListProps {
  items: TemporaryItem[]
  /** Reference instant for the active/expired check; defaults to now. */
  now?: Date
  onCreate: (input: TemporaryItemInput) => Promise<void>
  onUpdate: (id: string, input: TemporaryItemInput) => Promise<void>
  onDelete: (id: string) => void
}

interface TemporaryItemItemProps {
  item: TemporaryItem
  now: Date
  onEdit: () => void
  onDelete: () => void
}

/**
 * One temporary item as a dense table-like row for desktop: the name grows with
 * its active/expired flag beside it, its contribution right-aligned in a fixed
 * column, the controls at the end, and its end date on the caption line beneath.
 */
function TemporaryItemRow({ item, now, onEdit, onDelete }: TemporaryItemItemProps) {
  const active = isTemporaryActive({ contributionCents: 0, targetDate: item.target_date }, now)
  return (
    <ListRow gap="sm" caption={`until ${formatIsoDate(item.target_date)}`}>
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {item.name}
        </Text>
        <Badge size="xs" variant="light" color={active ? 'teal' : 'gray'}>
          {active ? 'Active' : 'Expired'}
        </Badge>
      </Group>
      <MoneyText
        cents={item.contribution_cents}
        fw={700}
        size="sm"
        ta="right"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One temporary item as a compact bordered card for mobile, with its active/expired state. */
function TemporaryItemCard({ item, now, onEdit, onDelete }: TemporaryItemItemProps) {
  const active = isTemporaryActive({ contributionCents: 0, targetDate: item.target_date }, now)
  return (
    <AppCard withBorder padding="xs">
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
          <MoneyText cents={item.contribution_cents} fw={700} size="sm" />
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * A single temporary item, rendered as a dense table-like row from the `sm`
 * breakpoint up and as a compact bordered card below it.
 */
function TemporaryItemItem(props: TemporaryItemItemProps) {
  const wide = useIsWide()
  return wide ? <TemporaryItemRow {...props} /> : <TemporaryItemCard {...props} />
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
  const { confirm, modal } = useConfirmDelete()

  const activeSubtotal = items.reduce(
    (total, item) =>
      isTemporaryActive({ contributionCents: 0, targetDate: item.target_date }, now)
        ? total + item.contribution_cents
        : total,
    0,
  )

  return (
    <GroupSection title="Temporary" subtotalCents={activeSubtotal}>
      {items.length === 0 && !adding && <EmptyState>No temporary items yet.</EmptyState>}

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
          <TemporaryItemItem
            key={item.id}
            item={item}
            now={now}
            onEdit={() => startEditing(item.id)}
            onDelete={() =>
              confirm({
                title: 'Delete temporary item?',
                itemLabel: item.name,
                onConfirm: () => onDelete(item.id),
              })
            }
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
        <AddButton label="Add temporary item" onClick={() => startAdding(true)} />
      )}

      {modal}
    </GroupSection>
  )
}
