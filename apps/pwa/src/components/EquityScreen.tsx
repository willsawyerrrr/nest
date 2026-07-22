import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import {
  exerciseCostCents,
  grantValueCents,
  grossVestedValueCents,
  vestedQuantity,
} from '@nest/plan'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type { EquityGrantInput, EquityGrantRow } from '../hooks/useEquityGrants'
import { useInlineEditing } from '../hooks/useInlineEditing'
import type { Member } from '../hooks/useMembers'
import { EQUITY_INSTRUMENT_TYPES, equityGrantToPlan, VESTING_FREQUENCIES } from '../lib/equity'
import { formatCents } from '../lib/money'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { EquityGrantForm } from './EquityGrantForm'

interface EquityScreenProps {
  members: Member[]
  grants: EquityGrantRow[]
  /** The reporting date grants are valued as of. */
  asOf: Date
  onCreate: (input: EquityGrantInput) => Promise<void>
  onUpdate: (id: string, input: EquityGrantInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

/** The human-readable label for an instrument type. */
function instrumentLabel(type: string): string {
  return EQUITY_INSTRUMENT_TYPES.find((entry) => entry.value === type)?.label ?? type
}

/** The human-readable label for a vesting frequency. */
function frequencyLabel(frequency: string): string {
  return VESTING_FREQUENCIES.find((entry) => entry.value === frequency)?.label ?? frequency
}

/**
 * One grant's display card, showing its schedule, vested quantity, and value.
 * The net "counts toward net worth" value is shown for every grant; an option
 * grant additionally breaks out its gross vested value and exercise cost, since
 * these differ from the net once the strike is paid.
 */
function GrantCard({
  grant,
  asOf,
  onEdit,
  onDelete,
}: {
  grant: EquityGrantRow
  asOf: Date
  onEdit: () => void
  onDelete: () => void
}) {
  const planGrant = equityGrantToPlan(grant)
  const vested = vestedQuantity(planGrant, asOf)
  const grossCents = grossVestedValueCents(planGrant, asOf)
  const exerciseCents = exerciseCostCents(planGrant, asOf)
  const netCents = grantValueCents(planGrant, asOf)
  // Options carry a strike, so gross, exercise cost, and net all differ and are
  // worth spelling out; a share grant's gross equals its net, so a single value
  // is clearer.
  const hasStrike = grant.instrument_type === 'option'
  return (
    <Card withBorder radius="md" p="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {grant.label}
          </Text>
          <Group gap={6} wrap="wrap">
            <Badge size="xs" variant="outline">
              {instrumentLabel(grant.instrument_type)}
            </Badge>
            <Badge size="xs" variant="light">
              {frequencyLabel(grant.vesting_frequency)}
            </Badge>
            <Text size="xs" c="dimmed">
              {vested.toLocaleString()} / {grant.quantity.toLocaleString()} vested
            </Text>
          </Group>
          {hasStrike && (
            <Text size="xs" c="dimmed">
              Vested value {formatCents(grossCents)} &middot; Exercise cost{' '}
              {formatCents(exerciseCents)} &middot; Counts as {formatCents(netCents)}
            </Text>
          )}
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text fw={700} size="sm">
            {formatCents(netCents)}
          </Text>
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </Card>
  )
}

/** A member's equity grants with an add affordance and inline add/edit forms. */
function MemberEquityGrants({
  member,
  grants,
  asOf,
  onCreate,
  onUpdate,
  onDelete,
}: {
  member: Member
  grants: EquityGrantRow[]
  asOf: Date
  onCreate: (input: EquityGrantInput) => Promise<void>
  onUpdate: (id: string, input: EquityGrantInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()
  const { confirm, modal } = useConfirmDelete()

  return (
    <Stack gap="xs">
      <Text fw={600}>{member.name}</Text>

      {grants.length === 0 && !adding && <EmptyState>No grants yet.</EmptyState>}

      {grants.map((grant) =>
        editingId === grant.id ? (
          <EquityGrantForm
            key={grant.id}
            member={member}
            initial={grant}
            onSubmit={async (input) => {
              await onUpdate(grant.id, input)
              closeForms()
            }}
            onCancel={closeForms}
          />
        ) : (
          <GrantCard
            key={grant.id}
            grant={grant}
            asOf={asOf}
            onEdit={() => startEditing(grant.id)}
            onDelete={() =>
              confirm({
                title: 'Delete grant?',
                itemLabel: grant.label,
                onConfirm: () => onDelete(grant.id),
              })
            }
          />
        ),
      )}

      {adding ? (
        <EquityGrantForm
          member={member}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <Button variant="light" size="xs" fullWidth onClick={() => startAdding(true)}>
          Add grant
        </Button>
      )}

      {modal}
    </Stack>
  )
}

/**
 * Presentational equity manager: one grouped list of grants per household member,
 * each grant showing its vesting schedule, vested quantity, and current vested
 * value. The vested value counts toward net worth as an asset. Persistence lives
 * in the caller.
 */
export function EquityScreen({
  members,
  grants,
  asOf,
  onCreate,
  onUpdate,
  onDelete,
}: EquityScreenProps) {
  return (
    <Stack gap="sm">
      <Title order={2} visibleFrom="sm">
        Equity
      </Title>
      <Text c="dimmed" size="sm">
        Each member&rsquo;s startup equity grants, vesting after a cliff. The vested value — options
        at their gain over the strike, shares at the price per share — counts toward household net
        worth. Keep the price per share current yourself.
      </Text>
      {members.map((member) => (
        <MemberEquityGrants
          key={member.id}
          member={member}
          grants={grants.filter((grant) => grant.member_id === member.id)}
          asOf={asOf}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
    </Stack>
  )
}
