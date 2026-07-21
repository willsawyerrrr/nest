import { useState, type FormEvent } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import type {
  GiftOccasion,
  GiftOccasionInput,
  GiftRecipient,
  GiftRecipientInput,
} from '../hooks/useGifts'
import { formatIsoDate } from '../lib/dates'
import { EmptyState } from './EmptyState'

interface GiftManagementProps {
  recipients: GiftRecipient[]
  occasions: GiftOccasion[]
  onCreateRecipient: (input: GiftRecipientInput) => Promise<void>
  onUpdateRecipient: (id: string, input: GiftRecipientInput) => Promise<void>
  onDeleteRecipient: (id: string) => Promise<void>
  onCreateOccasion: (input: GiftOccasionInput) => Promise<void>
  onUpdateOccasion: (id: string, input: GiftOccasionInput) => Promise<void>
  onDeleteOccasion: (id: string) => Promise<void>
}

/** A queued delete awaiting confirmation, carrying the cascade warning to show. */
interface PendingDelete {
  label: string
  onConfirm: () => Promise<void>
}

/** Add/edit form for a recipient (a name) or an occasion (a name and optional date). */
function GiftEntityForm({
  kind,
  initialName,
  initialDate,
  onSubmit,
  onCancel,
}: {
  kind: 'recipient' | 'occasion'
  initialName?: string
  initialDate?: string | null
  onSubmit: (name: string, date: string | null) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName ?? '')
  const [date, setDate] = useState<string | null>(initialDate ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(name.trim(), kind === 'occasion' ? date : null)
    } catch {
      setError('Could not save. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <TextInput
          label="Name"
          size="sm"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        {kind === 'occasion' && (
          <DateInput
            label="Date"
            size="sm"
            description="Optional. When the occasion falls."
            valueFormat="D MMM YYYY"
            clearable
            value={date}
            onChange={setDate}
          />
        )}
        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}
        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initialName === undefined ? 'Add' : 'Save changes'}
          </Button>
          <Button type="button" variant="default" onClick={onCancel}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}

/** One recipient or occasion row with edit/delete controls. */
function EntityRow({
  label,
  meta,
  onEdit,
  onDelete,
}: {
  label: string
  meta?: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {label}
          </Text>
          {meta && (
            <Text size="xs" c="dimmed">
              {meta}
            </Text>
          )}
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <ActionIcon variant="subtle" aria-label={`Edit ${label}`} onClick={onEdit}>
            <IconPencil size={16} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Delete ${label}`}
            onClick={onDelete}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Group>
    </Card>
  )
}

/**
 * Manages the household's gift recipients and occasions: add, rename, set an
 * occasion's optional date, and delete. A delete is confirmed first, warning
 * that it cascades to that entity's budgets and purchases.
 */
export function GiftManagement({
  recipients,
  occasions,
  onCreateRecipient,
  onUpdateRecipient,
  onDeleteRecipient,
  onCreateOccasion,
  onUpdateOccasion,
  onDeleteOccasion,
}: GiftManagementProps) {
  const [editingRecipientId, setEditingRecipientId] = useState<string | null>(null)
  const [addingRecipient, setAddingRecipient] = useState(false)
  const [editingOccasionId, setEditingOccasionId] = useState<string | null>(null)
  const [addingOccasion, setAddingOccasion] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!pendingDelete) {
      return
    }
    setDeleting(true)
    try {
      await pendingDelete.onConfirm()
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Title order={3}>Recipients</Title>
        {recipients.length === 0 && !addingRecipient && <EmptyState>No recipients yet.</EmptyState>}
        {recipients.map((recipient) =>
          editingRecipientId === recipient.id ? (
            <GiftEntityForm
              key={recipient.id}
              kind="recipient"
              initialName={recipient.name}
              onSubmit={async (name) => {
                await onUpdateRecipient(recipient.id, { name })
                setEditingRecipientId(null)
              }}
              onCancel={() => setEditingRecipientId(null)}
            />
          ) : (
            <EntityRow
              key={recipient.id}
              label={recipient.name}
              onEdit={() => {
                setAddingRecipient(false)
                setEditingRecipientId(recipient.id)
              }}
              onDelete={() =>
                setPendingDelete({
                  label: recipient.name,
                  onConfirm: () => onDeleteRecipient(recipient.id),
                })
              }
            />
          ),
        )}
        {addingRecipient ? (
          <GiftEntityForm
            kind="recipient"
            onSubmit={async (name) => {
              await onCreateRecipient({ name })
              setAddingRecipient(false)
            }}
            onCancel={() => setAddingRecipient(false)}
          />
        ) : (
          <Button
            variant="light"
            fullWidth
            onClick={() => {
              setEditingRecipientId(null)
              setAddingRecipient(true)
            }}
          >
            Add recipient
          </Button>
        )}
      </Stack>

      <Stack gap="sm">
        <Title order={3}>Occasions</Title>
        {occasions.length === 0 && !addingOccasion && <EmptyState>No occasions yet.</EmptyState>}
        {occasions.map((occasion) =>
          editingOccasionId === occasion.id ? (
            <GiftEntityForm
              key={occasion.id}
              kind="occasion"
              initialName={occasion.name}
              initialDate={occasion.occasion_date}
              onSubmit={async (name, date) => {
                await onUpdateOccasion(occasion.id, { name, occasion_date: date })
                setEditingOccasionId(null)
              }}
              onCancel={() => setEditingOccasionId(null)}
            />
          ) : (
            <EntityRow
              key={occasion.id}
              label={occasion.name}
              meta={occasion.occasion_date ? formatIsoDate(occasion.occasion_date) : undefined}
              onEdit={() => {
                setAddingOccasion(false)
                setEditingOccasionId(occasion.id)
              }}
              onDelete={() =>
                setPendingDelete({
                  label: occasion.name,
                  onConfirm: () => onDeleteOccasion(occasion.id),
                })
              }
            />
          ),
        )}
        {addingOccasion ? (
          <GiftEntityForm
            kind="occasion"
            onSubmit={async (name, date) => {
              await onCreateOccasion({ name, occasion_date: date })
              setAddingOccasion(false)
            }}
            onCancel={() => setAddingOccasion(false)}
          />
        ) : (
          <Button
            variant="light"
            fullWidth
            onClick={() => {
              setEditingOccasionId(null)
              setAddingOccasion(true)
            }}
          >
            Add occasion
          </Button>
        )}
      </Stack>

      <Modal
        opened={pendingDelete !== null}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        title="Delete?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Delete <b>{pendingDelete?.label}</b>? This also removes its gift budgets and every
            purchase recorded against them. This cannot be undone.
          </Text>
          <Group grow>
            <Button color="red" onClick={() => void confirmDelete()} loading={deleting}>
              Delete
            </Button>
            <Button variant="default" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
