import { useState } from 'react'
import { useDisclosure } from '@mantine/hooks'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { annualCents, fortnightlyCents } from '@nest/plan'
import { useInlineEditing } from '../hooks/useInlineEditing'
import { BreakdownPageLayout } from './BreakdownPageLayout'
import type { Breakdown, BreakdownUpdate } from '../hooks/useBreakdowns'
import type { BreakdownItem, BreakdownItemInput } from '../hooks/useBreakdownItems'
import type { BudgetGroup } from '../lib/domain'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { formatCents, formatPerFortnight, formatPerYear } from '../lib/money'
import { formatFrequency } from '../lib/frequency'
import { BreakdownItemForm } from './BreakdownItemForm'
import { FortnightlyAmount } from './FortnightlyAmount'

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
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm">
      <Stack gap="xs">
        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Select
          label="Group"
          size="sm"
          data={BUDGET_GROUPS}
          value={group}
          onChange={(value) => value && setGroup(value as BudgetGroup)}
          allowDeselect={false}
        />
        <Group grow>
          <Button onClick={() => void save()} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button color="red" variant="light" onClick={() => setConfirming(true)}>
            Delete breakdown
          </Button>
        </Group>
      </Stack>

      <Modal
        opened={confirming}
        onClose={() => (deleting ? undefined : setConfirming(false))}
        title="Delete breakdown?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Delete <b>{breakdown.name}</b>? This removes its items and its budget line. This cannot
            be undone.
          </Text>
          <Group grow>
            <Button color="red" onClick={() => void confirmDelete()} loading={deleting}>
              Delete
            </Button>
            <Button variant="default" onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  )
}

/** One item row with its normalised fortnightly figure and edit/delete controls. */
function ItemRow({
  item,
  onEdit,
  onDelete,
}: {
  item: BreakdownItem
  onEdit: () => void
  onDelete: () => void
}) {
  const fortnightly = fortnightlyCents(
    item.amount_cents,
    item.frequency,
    item.interval_weeks ?? undefined,
  )
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {item.name}
          </Text>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {formatCents(item.amount_cents)}
            </Text>
            <Badge size="xs" variant="light">
              {formatFrequency(item.frequency, item.interval_weeks)}
            </Badge>
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <FortnightlyAmount cents={fortnightly} />
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
        </Group>
      </Group>
    </Card>
  )
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

  const totalAnnual = items.reduce(
    (total, item) =>
      total + annualCents(item.amount_cents, item.frequency, item.interval_weeks ?? undefined),
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
          <Title order={3}>Items</Title>
          <Text fw={700} aria-label="Breakdown fortnightly total">
            {formatPerFortnight(totalFortnightly)}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          Rolls up to {formatPerYear(totalAnnual)}.
        </Text>

        {items.length === 0 && !adding && (
          <Text c="dimmed" size="sm">
            No items yet.
          </Text>
        )}

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
            <ItemRow
              key={item.id}
              item={item}
              onEdit={() => startEditing(item.id)}
              onDelete={() => void onDeleteItem(item.id)}
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
          <Button variant="light" fullWidth onClick={() => startAdding(true)}>
            Add item
          </Button>
        )}
      </Stack>
    </BreakdownPageLayout>
  )
}
