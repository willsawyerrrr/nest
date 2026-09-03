import { ActionIcon, Badge, Button, Group, Select, Stack, Text } from '@mantine/core'
import { IconBuildingBank, IconTargetArrow } from '@tabler/icons-react'
import type { Member } from '../hooks/useMembers'
import { useSortPreference } from '../hooks/useSortPreference'
import type { WishlistItem, WishlistItemInput } from '../hooks/useWishlist'
import { memberName } from '../lib/members'
import { sortBy, type SortPreference } from '../lib/sort'
import { AppCard } from './AppCard'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { WishlistForm } from './WishlistForm'

/** Which field the wishlist rows are ordered by. */
type SortKey = 'title' | 'amount'

const SORT_STORAGE_KEY = 'wishlist-sort'
const DEFAULT_SORT: SortPreference<SortKey> = { key: 'title', direction: 'asc' }

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'amount', label: 'Amount' },
]

/** Compares two items by the chosen key for ascending order. */
function compareItems(key: SortKey): (a: WishlistItem, b: WishlistItem) => number {
  return (a, b) =>
    key === 'title' ? a.name.localeCompare(b.name) : a.amount_cents - b.amount_cents
}

interface WishlistScreenProps {
  items: WishlistItem[]
  members: Member[]
  onCreate: (input: WishlistItemInput) => Promise<void>
  onUpdate: (id: string, input: WishlistItemInput) => Promise<void>
  onDelete: (id: string) => void
  /** Opens the Goals tab with a prefilled add form for this item. */
  onPromoteToGoal: (item: WishlistItem) => void
  /** Opens the Budget tab with a prefilled add form for this item. */
  onPromoteToBudget: (item: WishlistItem) => void
}

/** One wishlist item: its name, rough cost, optional owner and note, with promote and edit controls. */
function WishlistItemCard({
  item,
  ownerName,
  onEdit,
  onDelete,
  onPromoteToGoal,
  onPromoteToBudget,
}: {
  item: WishlistItem
  ownerName: string | null
  onEdit: () => void
  onDelete: () => void
  onPromoteToGoal: () => void
  onPromoteToBudget: () => void
}) {
  return (
    <AppCard withBorder padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Text fw={600} size="sm" truncate>
                {item.name}
              </Text>
              {ownerName && (
                <Badge size="xs" variant="light" color="gray">
                  {ownerName}
                </Badge>
              )}
            </Group>
            {item.note && (
              <Text size="xs" c="dimmed">
                {item.note}
              </Text>
            )}
          </Stack>
          <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }} align="center">
            <MoneyText cents={item.amount_cents} fw={600} size="sm" />
            <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          </Group>
        </Group>
        <Group gap="xs">
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconTargetArrow size={14} />}
            onClick={onPromoteToGoal}
          >
            Make a savings goal
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconBuildingBank size={14} />}
            onClick={onPromoteToBudget}
          >
            Add to budget
          </Button>
        </Group>
      </Stack>
    </AppCard>
  )
}

/**
 * Presentational wishlist manager: the household's aspirational purchases, sorted
 * by title or amount, each promotable to a savings goal or a Discretionary budget
 * line prefilled from the item. The item stays after promoting. Persistence and
 * the promote navigation live in the caller.
 */
export function WishlistScreen({
  items,
  members,
  onCreate,
  onUpdate,
  onDelete,
  onPromoteToGoal,
  onPromoteToBudget,
}: WishlistScreenProps) {
  const {
    key: sortKey,
    direction,
    setKey,
    toggleDirection,
  } = useSortPreference(SORT_STORAGE_KEY, DEFAULT_SORT)
  const sorted = sortBy(items, compareItems(sortKey), direction)

  return (
    <PageSection
      title="Wishlist"
      intro="Things you’re saving up to buy one day — kept apart from the budget. Promote one to a savings goal or a Discretionary budget line when you’re ready; the wishlist item stays until you delete it."
    >
      {items.length > 0 && (
        <Group gap="xs" wrap="nowrap" justify="flex-end">
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
            {direction === 'asc' ? '↑' : '↓'}
          </ActionIcon>
        </Group>
      )}

      <EditableList<WishlistItem, WishlistItemInput>
        items={sorted}
        addLabel="Add wishlist item"
        emptyMessage="Nothing on your wishlist yet."
        deleteTarget={(item) => ({ title: 'Delete wishlist item?', itemLabel: item.name })}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        renderItem={(item, { onEdit, onDelete: onDeleteItem }) => (
          <WishlistItemCard
            item={item}
            ownerName={item.member_id ? memberName(members, item.member_id) : null}
            onEdit={onEdit}
            onDelete={onDeleteItem}
            onPromoteToGoal={() => onPromoteToGoal(item)}
            onPromoteToBudget={() => onPromoteToBudget(item)}
          />
        )}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <WishlistForm
            initial={initial}
            members={members}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
      />
    </PageSection>
  )
}
