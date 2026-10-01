import { ActionIcon, Badge, Group, Menu, Select, Stack, Text } from '@mantine/core'
import { IconBuildingBank, IconDots, IconTargetArrow } from '@tabler/icons-react'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import { useSortPreference } from '../hooks/useSortPreference'
import type { WishlistItem, WishlistItemInput } from '../hooks/useWishlist'
import { memberName } from '../lib/members'
import { sortBy, type SortPreference } from '../lib/sort'
import { AppCard } from './AppCard'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { ListRow } from './ListRow'
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

interface WishlistItemProps {
  item: WishlistItem
  ownerName: string | null
  onEdit: () => void
  onDelete: () => void
  onPromoteToGoal: () => void
  onPromoteToBudget: () => void
}

/** The overflow menu holding an item's two promote actions. */
function PromoteMenu({
  onPromoteToGoal,
  onPromoteToBudget,
}: Pick<WishlistItemProps, 'onPromoteToGoal' | 'onPromoteToBudget'>) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" aria-label="Promote">
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconTargetArrow size={14} />} onClick={onPromoteToGoal}>
          Make a savings goal
        </Menu.Item>
        <Menu.Item leftSection={<IconBuildingBank size={14} />} onClick={onPromoteToBudget}>
          Add to budget
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

/** The owner pill beside an item's name. */
function OwnerBadge({ ownerName }: { ownerName: string | null }) {
  return (
    ownerName && (
      <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
        {ownerName}
      </Badge>
    )
  )
}

/**
 * One wishlist item as a dense table-like row for desktop: the name and owner pill
 * grow to fill, the note sits beneath as a caption, and the amount lines up in a
 * fixed right-aligned column ahead of the promote menu and edit/delete controls.
 */
function WishlistRow({ item, ownerName, ...actions }: WishlistItemProps) {
  return (
    <ListRow gap="sm" caption={item.note ?? undefined}>
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate style={{ minWidth: 0 }}>
          {item.name}
        </Text>
        <OwnerBadge ownerName={ownerName} />
      </Group>
      <MoneyText
        cents={item.amount_cents}
        fw={600}
        size="sm"
        ta="right"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <PromoteMenu {...actions} />
        <EditDeleteActions onEdit={actions.onEdit} onDelete={actions.onDelete} />
      </Group>
    </ListRow>
  )
}

/** One wishlist item as a compact bordered card for mobile. */
function WishlistCard({ item, ownerName, ...actions }: WishlistItemProps) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={600} size="sm" truncate style={{ minWidth: 0 }}>
              {item.name}
            </Text>
            <OwnerBadge ownerName={ownerName} />
          </Group>
          {item.note && (
            <Text size="xs" c="dimmed">
              {item.note}
            </Text>
          )}
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }} align="center">
          <MoneyText cents={item.amount_cents} fw={600} size="sm" />
          <PromoteMenu {...actions} />
          <EditDeleteActions onEdit={actions.onEdit} onDelete={actions.onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/** A wishlist item as a dense row from the `sm` breakpoint up and a compact card below it. */
function WishlistItemView(props: WishlistItemProps) {
  const wide = useIsWide()
  return wide ? <WishlistRow {...props} /> : <WishlistCard {...props} />
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
          <WishlistItemView
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
