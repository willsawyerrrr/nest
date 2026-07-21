import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution, SuperContributionInput } from '../hooks/useSuperContributions'
import { formatCents } from '../lib/money'
import { formatFrequency } from '../lib/frequency'
import { SUPER_CONTRIBUTION_KINDS } from '../lib/super'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
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

/** One contribution's display card, with edit/delete controls. */
function ContributionCard({
  contribution,
  memberName,
  onEdit,
  onDelete,
}: {
  contribution: SuperContribution
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {kindLabel(contribution.kind)}
          </Text>
          <Group gap={6} wrap="wrap">
            <Badge size="xs" variant="outline">
              {formatFrequency(contribution.frequency, contribution.interval_weeks)}
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
    </Card>
  )
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
          <ContributionCard
            key={contribution.id}
            contribution={contribution}
            memberName={memberName}
            onEdit={() => startEditing(contribution.id)}
            onDelete={() => onDelete(contribution.id)}
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
        <Button variant="light" size="xs" fullWidth onClick={() => startAdding(true)}>
          Add contribution
        </Button>
      )}
    </Stack>
  )
}
