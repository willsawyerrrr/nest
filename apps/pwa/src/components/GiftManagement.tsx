import { useState, type FormEvent } from 'react'
import { ActionIcon, Badge, Button, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type {
  GiftOccasion,
  GiftOccasionInput,
  GiftRecipient,
  GiftRecipientInput,
} from '../hooks/useGifts'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate } from '../lib/dates'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EmptyState } from './EmptyState'
import { ListRow } from './ListRow'

interface GiftManagementProps {
  recipients: GiftRecipient[]
  occasions: GiftOccasion[]
  members: Member[]
  /** The signed-in member's id, or null while unresolved / for a user with no member row. */
  currentMemberId: string | null
  onCreateRecipient: (input: GiftRecipientInput) => Promise<void>
  onUpdateRecipient: (id: string, input: GiftRecipientInput) => Promise<void>
  onDeleteRecipient: (id: string) => Promise<void>
  onCreateOccasion: (input: GiftOccasionInput) => Promise<void>
  onUpdateOccasion: (id: string, input: GiftOccasionInput) => Promise<void>
  onDeleteOccasion: (id: string) => Promise<void>
}

/** The values a recipient or occasion form submits; each editor reads the fields it uses. */
interface GiftEntityValues {
  name: string
  date: string | null
}

/** The cascade warning shared by a recipient's and an occasion's delete confirmation. */
const CASCADE_WARNING =
  'This also removes its gift budgets and every purchase recorded against them. This cannot be undone.'

/**
 * Add/edit form for an external recipient (a name) or an occasion (a name and an
 * optional date). Household members are permanent recipients created automatically,
 * so this form only ever adds or edits external people.
 */
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
  onSubmit: (values: GiftEntityValues) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName ?? '')
  const [date, setDate] = useState<string | null>(initialDate ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !submitting && name.trim() !== ''

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), date: kind === 'occasion' ? date : null })
    } catch {
      setError('Could not save. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <AppCard withBorder padding="sm" component="form" onSubmit={handleSubmit}>
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
    </AppCard>
  )
}

interface EntityRowProps {
  label: string
  meta?: string
  tag?: string
  actions?: { onEdit: () => void; onDelete: () => void }
}

/** The label with its optional tag badge, growing to fill the row. */
function EntityLabel({ label, tag }: { label: string; tag?: string }) {
  return (
    <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
      <Text fw={600} size="sm" truncate>
        {label}
      </Text>
      {tag && (
        <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
          {tag}
        </Badge>
      )}
    </Group>
  )
}

/** An entity's edit and delete controls, labelled by the entity so each row's pair stays distinct. */
function EntityActions({
  label,
  actions,
}: {
  label: string
  actions: { onEdit: () => void; onDelete: () => void }
}) {
  return (
    <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
      <ActionIcon variant="subtle" aria-label={`Edit ${label}`} onClick={actions.onEdit}>
        <IconPencil size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Delete ${label}`}
        onClick={actions.onDelete}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  )
}

/** One recipient or occasion as a dense table-like row for desktop, its meta on the caption line. */
function EntityRow({ label, meta, tag, actions }: EntityRowProps) {
  return (
    <ListRow caption={meta}>
      <EntityLabel label={label} tag={tag} />
      {actions && <EntityActions label={label} actions={actions} />}
    </ListRow>
  )
}

/** One recipient or occasion as a compact bordered card for mobile: label stacked over its meta. */
function EntityCard({ label, meta, tag, actions }: EntityRowProps) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <EntityLabel label={label} tag={tag} />
          {meta && (
            <Text size="xs" c="dimmed">
              {meta}
            </Text>
          )}
        </Stack>
        {actions && <EntityActions label={label} actions={actions} />}
      </Group>
    </AppCard>
  )
}

/**
 * One recipient or occasion, rendered as a dense table-like row from the `sm`
 * breakpoint up and as a compact bordered card below it. Edit and delete controls
 * appear only when an `actions` pair is supplied; a member recipient is fixed and
 * passes none.
 */
function EntityItem(props: EntityRowProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <EntityRow {...props} /> : <EntityCard {...props} />
}

/**
 * Manages the household's gift recipients and occasions. Each household member is
 * a permanent recipient, shown first as a fixed row that cannot be edited or
 * deleted; external people are added, renamed, and removed below. An occasion
 * carries an optional date. A delete is confirmed first, warning that it cascades
 * to that entity's budgets and purchases.
 */
export function GiftManagement({
  recipients,
  occasions,
  members,
  currentMemberId,
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
  const { confirm, modal } = useConfirmDelete()

  const memberNameById = new Map(members.map((member) => [member.id, member.name]))
  const memberRecipients = recipients.filter((recipient) => recipient.member_id !== null)
  const externalRecipients = recipients.filter((recipient) => recipient.member_id === null)

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Title order={3} size="h5">
          Recipients
        </Title>
        {recipients.length === 0 && !addingRecipient && <EmptyState>No recipients yet.</EmptyState>}
        {memberRecipients.map((recipient) => (
          <EntityItem
            key={recipient.id}
            label={memberNameById.get(recipient.member_id as string) ?? recipient.name}
            tag="Household member"
            meta={
              recipient.member_id === currentMemberId
                ? 'Purchases hidden from you'
                : 'Purchases hidden from them'
            }
          />
        ))}
        {externalRecipients.map((recipient) =>
          editingRecipientId === recipient.id ? (
            <GiftEntityForm
              key={recipient.id}
              kind="recipient"
              initialName={recipient.name}
              onSubmit={async ({ name }) => {
                await onUpdateRecipient(recipient.id, { name, member_id: null })
                setEditingRecipientId(null)
              }}
              onCancel={() => setEditingRecipientId(null)}
            />
          ) : (
            <EntityItem
              key={recipient.id}
              label={recipient.name}
              actions={{
                onEdit: () => {
                  setAddingRecipient(false)
                  setEditingRecipientId(recipient.id)
                },
                onDelete: () =>
                  confirm({
                    title: 'Delete recipient?',
                    itemLabel: recipient.name,
                    description: CASCADE_WARNING,
                    onConfirm: () => onDeleteRecipient(recipient.id),
                  }),
              }}
            />
          ),
        )}
        {addingRecipient ? (
          <GiftEntityForm
            kind="recipient"
            onSubmit={async ({ name }) => {
              await onCreateRecipient({ name, member_id: null })
              setAddingRecipient(false)
            }}
            onCancel={() => setAddingRecipient(false)}
          />
        ) : (
          <AddButton
            label="Add recipient"
            onClick={() => {
              setEditingRecipientId(null)
              setAddingRecipient(true)
            }}
          />
        )}
      </Stack>

      <Stack gap="sm">
        <Title order={3} size="h5">
          Occasions
        </Title>
        {occasions.length === 0 && !addingOccasion && <EmptyState>No occasions yet.</EmptyState>}
        {occasions.map((occasion) =>
          editingOccasionId === occasion.id ? (
            <GiftEntityForm
              key={occasion.id}
              kind="occasion"
              initialName={occasion.name}
              initialDate={occasion.occasion_date}
              onSubmit={async ({ name, date }) => {
                await onUpdateOccasion(occasion.id, { name, occasion_date: date })
                setEditingOccasionId(null)
              }}
              onCancel={() => setEditingOccasionId(null)}
            />
          ) : (
            <EntityItem
              key={occasion.id}
              label={occasion.name}
              meta={occasion.occasion_date ? formatIsoDate(occasion.occasion_date) : undefined}
              actions={{
                onEdit: () => {
                  setAddingOccasion(false)
                  setEditingOccasionId(occasion.id)
                },
                onDelete: () =>
                  confirm({
                    title: 'Delete occasion?',
                    itemLabel: occasion.name,
                    description: CASCADE_WARNING,
                    onConfirm: () => onDeleteOccasion(occasion.id),
                  }),
              }}
            />
          ),
        )}
        {addingOccasion ? (
          <GiftEntityForm
            kind="occasion"
            onSubmit={async ({ name, date }) => {
              await onCreateOccasion({ name, occasion_date: date })
              setAddingOccasion(false)
            }}
            onCancel={() => setAddingOccasion(false)}
          />
        ) : (
          <AddButton
            label="Add occasion"
            onClick={() => {
              setEditingOccasionId(null)
              setAddingOccasion(true)
            }}
          />
        )}
      </Stack>

      {modal}
    </Stack>
  )
}
