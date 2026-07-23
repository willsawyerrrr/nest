import { useState } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { annualCents, fortnightlyCents } from '@nest/plan'
import type { BreakdownItem, BreakdownItemInput } from '../hooks/useBreakdownItems'
import type { Breakdown, BreakdownUpdate } from '../hooks/useBreakdowns'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { useInlineEditing } from '../hooks/useInlineEditing'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import type { BudgetGroup } from '../lib/domain'
import { formatFrequency } from '../lib/frequency'
import { formatPerFortnight, formatPerYear } from '../lib/money'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { BreakdownItemForm } from './BreakdownItemForm'
import { BreakdownPageLayout } from './BreakdownPageLayout'
import { EmptyState } from './EmptyState'
import { EnumSelect } from './EnumSelect'
import { FortnightlyAmount } from './FortnightlyAmount'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'

interface BreakdownDetailProps {
  breakdown: Breakdown
  items: BreakdownItem[]
  /** Where the back link returns to. */
  backTo: string
  /** The back link's label, naming its destination. */
  backLabel: string
  onUpdateBreakdown: (input: BreakdownUpdate) => Promise<void>
  onDeleteBreakdown: () => Promise<void>
  onCreateItem: (input: BreakdownItemInput) => Promise<void>
  onUpdateItem: (id: string, input: BreakdownItemInput) => Promise<void>
  onDeleteItem: (id: string) => Promise<void>
}

/** The breakdown's name and group, editable inline. */
function BreakdownSettings({
  breakdown,
  onSave,
  onDelete,
}: {
  breakdown: Breakdown
  onSave: (input: BreakdownUpdate) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(breakdown.name)
  const [group, setGroup] = useState<BudgetGroup>(breakdown.line_group)
  const [saving, setSaving] = useState(false)
  const { confirm, modal } = useConfirmDelete()

  const dirty = name.trim() !== breakdown.name || group !== breakdown.line_group
  const canSave = name.trim() !== '' && dirty && !saving

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ name: name.trim(), line_group: group })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppCard withBorder padding="sm">
      <Stack gap="xs">
        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <EnumSelect
          label="Group"
          size="sm"
          data={BUDGET_GROUPS}
          value={group}
          onChange={(value) => value && setGroup(value)}
          allowDeselect={false}
        />
        <Group grow>
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            color="red"
            variant="light"
            onClick={() =>
              confirm({
                title: 'Delete breakdown?',
                itemLabel: breakdown.name,
                description:
                  'This removes its items and the budget item they roll up into. This cannot be undone.',
                onConfirm: onDelete,
              })
            }
          >
            Delete breakdown
          </Button>
        </Group>
      </Stack>

      {modal}
    </AppCard>
  )
}

interface ItemRowProps {
  item: BreakdownItem
  onEdit: () => void
  onDelete: () => void
}

/**
 * An item's edit and delete controls. The labels name the item so they stay
 * distinct from the breakdown's own Edit toggle in the page header.
 */
function ItemActions({ item, onEdit, onDelete }: ItemRowProps) {
  return (
    <>
      <ActionIcon variant="subtle" aria-label={`Edit ${item.name}`} onClick={onEdit}>
        <IconPencil size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Delete ${item.name}`}
        onClick={onDelete}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </>
  )
}

/**
 * One breakdown item as a dense table-like row for desktop: the name grows to
 * fill, with the amount, frequency, and fortnightly figure right-aligned in fixed
 * columns and the controls at the end, exactly as a budget item's row.
 */
function ItemRow({ item, onEdit, onDelete }: ItemRowProps) {
  const fortnightly = fortnightlyCents(
    item.amount_cents,
    item.frequency,
    item.interval_count ?? undefined,
  )
  return (
    <ListRow>
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {item.name}
        </Text>
      </Group>
      <MoneyText
        cents={item.amount_cents}
        size="sm"
        c="dimmed"
        ta="right"
        style={{ width: '6rem', flexShrink: 0 }}
      />
      <Box style={{ width: '8rem', flexShrink: 0, textAlign: 'right' }}>
        <Badge size="xs" variant="light">
          {formatFrequency(item.frequency, item.interval_count)}
        </Badge>
      </Box>
      <FortnightlyAmount
        cents={fortnightly}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap={4} wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
        <ItemActions item={item} onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One breakdown item as a compact bordered card for mobile: name stacked over its facts. */
function ItemCard({ item, onEdit, onDelete }: ItemRowProps) {
  const fortnightly = fortnightlyCents(
    item.amount_cents,
    item.frequency,
    item.interval_count ?? undefined,
  )
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {item.name}
          </Text>
          <Group gap={6} wrap="nowrap">
            <MoneyText cents={item.amount_cents} size="xs" c="dimmed" />
            <Badge size="xs" variant="light">
              {formatFrequency(item.frequency, item.interval_count)}
            </Badge>
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <FortnightlyAmount cents={fortnightly} />
          <ItemActions item={item} onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * A single breakdown item, rendered as a dense table-like row from the `sm`
 * breakpoint up and as a compact bordered card below it.
 */
function ItemDisplay(props: ItemRowProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <ItemRow {...props} /> : <ItemCard {...props} />
}

/** Presentational editor for a generic breakdown: its settings and its item list. */
export function BreakdownDetail({
  breakdown,
  items,
  backTo,
  backLabel,
  onUpdateBreakdown,
  onDeleteBreakdown,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
}: BreakdownDetailProps) {
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()
  const [editing, { toggle: toggleEditing }] = useDisclosure(false)
  const { confirm, modal } = useConfirmDelete()

  const totalAnnual = items.reduce(
    (total, item) =>
      total + annualCents(item.amount_cents, item.frequency, item.interval_count ?? undefined),
    0,
  )
  const totalFortnightly = fortnightlyCents(totalAnnual, 'annual')

  return (
    <BreakdownPageLayout
      backTo={backTo}
      backLabel={backLabel}
      title={breakdown.name}
      action={
        <Button variant={editing ? 'filled' : 'default'} onClick={toggleEditing}>
          {editing ? 'Done' : 'Edit'}
        </Button>
      }
    >
      <Collapse expanded={editing}>
        <BreakdownSettings
          breakdown={breakdown}
          onSave={onUpdateBreakdown}
          onDelete={onDeleteBreakdown}
        />
      </Collapse>

      <Stack gap="sm">
        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Title order={3} size="h5">
            Items
          </Title>
          <Text fw={700} aria-label="Breakdown fortnightly total">
            {formatPerFortnight(totalFortnightly)}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          Rolls up to {formatPerYear(totalAnnual)}.
        </Text>

        {items.length === 0 && !adding && <EmptyState>No items yet.</EmptyState>}

        {items.map((item) =>
          editingId === item.id ? (
            <BreakdownItemForm
              key={item.id}
              initial={item}
              onSubmit={async (input) => {
                await onUpdateItem(item.id, input)
                closeForms()
              }}
              onCancel={closeForms}
            />
          ) : (
            <ItemDisplay
              key={item.id}
              item={item}
              onEdit={() => startEditing(item.id)}
              onDelete={() =>
                confirm({
                  title: 'Delete item?',
                  itemLabel: item.name,
                  onConfirm: () => onDeleteItem(item.id),
                })
              }
            />
          ),
        )}

        {adding ? (
          <BreakdownItemForm
            onSubmit={async (input) => {
              await onCreateItem(input)
              closeForms()
            }}
            onCancel={closeForms}
          />
        ) : (
          <AddButton label="Add item" onClick={() => startAdding(true)} />
        )}
      </Stack>

      {modal}
    </BreakdownPageLayout>
  )
}
