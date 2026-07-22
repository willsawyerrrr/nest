import { useState, type FormEvent } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
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
import { EmptyState } from './EmptyState'

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
  memberId: string | null
}

/** The cascade warning shared by a recipient's and an occasion's delete confirmation. */
const CASCADE_WARNING =
  'This also removes its gift budgets and every purchase recorded against them. This cannot be undone.'

/** The "Who is this for?" option that marks a recipient as an external, non-member person. */
const EXTERNAL_VALUE = '__external__'

/**
 * Add/edit form for a recipient (a household member or an external person) or an
 * occasion (a name and optional date). A member-linked recipient takes the
 * member's name automatically; an external recipient supplies its own name.
 */
function GiftEntityForm({
  kind,
  members,
  initialName,
  initialDate,
  initialMemberId,
  onSubmit,
  onCancel,
}: {
  kind: 'recipient' | 'occasion'
  members?: Member[]
  initialName?: string
  initialDate?: string | null
  initialMemberId?: string | null
  onSubmit: (values: GiftEntityValues) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName ?? '')
  const [date, setDate] = useState<string | null>(initialDate ?? null)
  // Who the recipient is: a member id, EXTERNAL_VALUE for someone else, or null
  // until a choice is made. Editing an existing external recipient (a name but no
  // member) starts on EXTERNAL_VALUE; adding starts unset.
  const [who, setWho] = useState<string | null>(
    initialMemberId ?? (initialName !== undefined ? EXTERNAL_VALUE : null),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isExternal = who === EXTERNAL_VALUE
  const isMember = who !== null && !isExternal
  const showName = kind === 'occasion' || isExternal

  const canSubmit =
    !submitting &&
    (kind === 'recipient' ? isMember || (isExternal && name.trim() !== '') : name.trim() !== '')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const selectedMember = isMember ? members?.find((member) => member.id === who) : undefined
    try {
      await onSubmit({
        name: selectedMember ? selectedMember.name : name.trim(),
        date: kind === 'occasion' ? date : null,
        memberId: kind === 'recipient' && isMember ? who : null,
      })
    } catch {
      setError('Could not save. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        {kind === 'recipient' && members && (
          <Select
            label="Who is this for?"
            size="sm"
            description="A household member's gift purchases and remaining budget stay hidden from them."
            placeholder="Choose a person"
            data={[
              ...members.map((member) => ({ value: member.id, label: member.name })),
              { value: EXTERNAL_VALUE, label: 'Someone else…' },
            ]}
            value={who}
            onChange={setWho}
          />
        )}
        {showName && (
          <TextInput
            label="Name"
            size="sm"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        )}
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

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Title order={3} size="h5">
          Recipients
        </Title>
        {recipients.length === 0 && !addingRecipient && <EmptyState>No recipients yet.</EmptyState>}
        {recipients.map((recipient) =>
          editingRecipientId === recipient.id ? (
            <GiftEntityForm
              key={recipient.id}
              kind="recipient"
              members={members}
              initialName={recipient.name}
              initialMemberId={recipient.member_id}
              onSubmit={async ({ name, memberId }) => {
                await onUpdateRecipient(recipient.id, { name, member_id: memberId })
                setEditingRecipientId(null)
              }}
              onCancel={() => setEditingRecipientId(null)}
            />
          ) : (
            <EntityRow
              key={recipient.id}
              label={
                recipient.member_id
                  ? (memberNameById.get(recipient.member_id) ?? recipient.name)
                  : recipient.name
              }
              meta={
                recipient.member_id
                  ? recipient.member_id === currentMemberId
                    ? 'Purchases hidden from you'
                    : 'Purchases hidden from them'
                  : undefined
              }
              onEdit={() => {
                setAddingRecipient(false)
                setEditingRecipientId(recipient.id)
              }}
              onDelete={() =>
                confirm({
                  title: 'Delete recipient?',
                  itemLabel: recipient.name,
                  description: CASCADE_WARNING,
                  onConfirm: () => onDeleteRecipient(recipient.id),
                })
              }
            />
          ),
        )}
        {addingRecipient ? (
          <GiftEntityForm
            kind="recipient"
            members={members}
            onSubmit={async ({ name, memberId }) => {
              await onCreateRecipient({ name, member_id: memberId })
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
            <EntityRow
              key={occasion.id}
              label={occasion.name}
              meta={occasion.occasion_date ? formatIsoDate(occasion.occasion_date) : undefined}
              onEdit={() => {
                setAddingOccasion(false)
                setEditingOccasionId(occasion.id)
              }}
              onDelete={() =>
                confirm({
                  title: 'Delete occasion?',
                  itemLabel: occasion.name,
                  description: CASCADE_WARNING,
                  onConfirm: () => onDeleteOccasion(occasion.id),
                })
              }
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

      {modal}
    </Stack>
  )
}
