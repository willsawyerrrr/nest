import { Badge, Group, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution, SuperContributionInput } from '../hooks/useSuperContributions'
import { formatFrequency } from '../lib/frequency'
import { formatCents } from '../lib/money'
import { SUPER_CONTRIBUTION_KINDS } from '../lib/super'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { ListRow } from './ListRow'
import { SuperContributionForm } from './SuperContributionForm'

interface SuperContributionListProps {
  member: Member
  members: Member[]
  contributions: SuperContribution[]
  onCreate: (input: SuperContributionInput) => Promise<void>
  onUpdate: (id: string, input: SuperContributionInput) => Promise<void>
  onDelete: (id: string) => void
}

/** The human-readable label for a contribution kind. */
function kindLabel(kind: SuperContribution['kind']): string {
  return SUPER_CONTRIBUTION_KINDS.find((entry) => entry.value === kind)?.label ?? kind
}

/** A contribution's entered value: a flat amount, or a percent of gross salary. */
function describeValue(contribution: SuperContribution): string {
  if (contribution.mode === 'percent') {
    return `${(contribution.percent_bp ?? 0) / 100}% of salary`
  }
  return formatCents(contribution.amount_cents ?? 0)
}

interface ContributionItemProps {
  contribution: SuperContribution
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}

/**
 * One contribution as a dense table-like row for desktop: the kind grows with its
 * frequency and FHSS badges beside it, the entered value right-aligned in a fixed
 * column, the controls at the end, and the contributor on the caption line beneath.
 */
function ContributionRow({ contribution, memberName, onEdit, onDelete }: ContributionItemProps) {
  return (
    <ListRow
      gap="sm"
      caption={
        contribution.contributor_member_id
          ? `by ${memberName(contribution.contributor_member_id)}`
          : undefined
      }
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {kindLabel(contribution.kind)}
        </Text>
        <Badge size="xs" variant="light" color="gray">
          {formatFrequency(contribution.frequency, contribution.interval_count)}
        </Badge>
        {contribution.fhss_eligible && (
          <Badge size="xs" variant="light" color="teal">
            FHSS
          </Badge>
        )}
      </Group>
      <Text fw={700} size="sm" ta="right" style={{ width: '9rem', flexShrink: 0 }}>
        {describeValue(contribution)}
      </Text>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One contribution as a compact bordered card for mobile, with edit/delete controls. */
function ContributionCard({ contribution, memberName, onEdit, onDelete }: ContributionItemProps) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {kindLabel(contribution.kind)}
          </Text>
          <Group gap={6} wrap="wrap">
            <Badge size="xs" variant="light" color="gray">
              {formatFrequency(contribution.frequency, contribution.interval_count)}
            </Badge>
            {contribution.fhss_eligible && (
              <Badge size="xs" variant="light" color="teal">
                FHSS
              </Badge>
            )}
            {contribution.contributor_member_id && (
              <Text size="xs" c="dimmed">
                by {memberName(contribution.contributor_member_id)}
              </Text>
            )}
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text fw={700} size="sm">
            {describeValue(contribution)}
          </Text>
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * A single contribution, rendered as a dense table-like row from the `sm`
 * breakpoint up and as a compact bordered card below it.
 */
function ContributionItem(props: ContributionItemProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <ContributionRow {...props} /> : <ContributionCard {...props} />
}

/** A member's super contributions with an add affordance and inline add/edit forms. */
export function SuperContributionList({
  member,
  members,
  contributions,
  onCreate,
  onUpdate,
  onDelete,
}: SuperContributionListProps) {
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()
  const { confirm, modal } = useConfirmDelete()
  const memberName = (id: string) =>
    members.find((candidate) => candidate.id === id)?.name ?? 'Unknown'

  return (
    <Stack gap="xs">
      {contributions.length === 0 && !adding && <EmptyState>No contributions yet.</EmptyState>}

      {contributions.map((contribution) =>
        editingId === contribution.id ? (
          <SuperContributionForm
            key={contribution.id}
            member={member}
            members={members}
            initial={contribution}
            onSubmit={async (input) => {
              await onUpdate(contribution.id, input)
              closeForms()
            }}
            onCancel={closeForms}
          />
        ) : (
          <ContributionItem
            key={contribution.id}
            contribution={contribution}
            memberName={memberName}
            onEdit={() => startEditing(contribution.id)}
            onDelete={() =>
              confirm({
                title: 'Delete contribution?',
                itemLabel: kindLabel(contribution.kind),
                onConfirm: () => onDelete(contribution.id),
              })
            }
          />
        ),
      )}

      {adding ? (
        <SuperContributionForm
          member={member}
          members={members}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <AddButton label="Add contribution" onClick={() => startAdding(true)} />
      )}

      {modal}
    </Stack>
  )
}
