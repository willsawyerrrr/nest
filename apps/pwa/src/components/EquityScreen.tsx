import { Badge, Group, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
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
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { EquityGrantForm } from './EquityGrantForm'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

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

interface GrantItemProps {
  grant: EquityGrantRow
  asOf: Date
  onEdit: () => void
  onDelete: () => void
}

/** A grant's derived facts: its vested quantity, net value, and option breakdown. */
function grantFacts(grant: EquityGrantRow, asOf: Date) {
  const planGrant = equityGrantToPlan(grant)
  // Options carry a strike, so gross vested value and exercise cost both differ
  // from the net headline and are worth spelling out; a share grant's gross
  // equals its net, so a single value is clearer.
  const hasStrike = grant.instrument_type === 'option'
  return {
    vested: vestedQuantity(planGrant, asOf),
    grossCents: grossVestedValueCents(planGrant, asOf),
    exerciseCents: exerciseCostCents(planGrant, asOf),
    netCents: grantValueCents(planGrant, asOf),
    hasStrike,
  }
}

/**
 * One grant as a dense table-like row for desktop: the label grows with its
 * instrument and vesting-frequency badges beside it, the vested quantity and net
 * value right-aligned in fixed columns, the controls at the end, and an option
 * grant's gross value and exercise cost on the caption line beneath.
 */
function GrantRow({ grant, asOf, onEdit, onDelete }: GrantItemProps) {
  const { vested, grossCents, exerciseCents, netCents, hasStrike } = grantFacts(grant, asOf)
  return (
    <ListRow
      gap="sm"
      caption={
        hasStrike
          ? `Vested value ${formatCents(grossCents)} · Exercise cost ${formatCents(exerciseCents)}`
          : undefined
      }
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {grant.label}
        </Text>
        <Badge
          size="xs"
          variant="light"
          color={grant.instrument_type === 'option' ? 'violet' : 'cyan'}
        >
          {instrumentLabel(grant.instrument_type)}
        </Badge>
        <Badge size="xs" variant="light" color="gray">
          {frequencyLabel(grant.vesting_frequency)}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed" ta="right" style={{ width: '9rem', flexShrink: 0 }}>
        {vested.toLocaleString()} / {grant.quantity.toLocaleString()} vested
      </Text>
      <MoneyText
        cents={netCents}
        fw={700}
        size="sm"
        ta="right"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/**
 * One grant as a compact bordered card for mobile, showing its schedule, vested
 * quantity, and value. The net "counts toward net worth" value is shown for every
 * grant; an option grant additionally breaks out its gross vested value and
 * exercise cost, since these differ from the net once the strike is paid.
 */
function GrantCard({ grant, asOf, onEdit, onDelete }: GrantItemProps) {
  const { vested, grossCents, exerciseCents, netCents, hasStrike } = grantFacts(grant, asOf)
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {grant.label}
          </Text>
          <Group gap={6} wrap="wrap">
            <Badge
              size="xs"
              variant="light"
              color={grant.instrument_type === 'option' ? 'violet' : 'cyan'}
            >
              {instrumentLabel(grant.instrument_type)}
            </Badge>
            <Badge size="xs" variant="light" color="gray">
              {frequencyLabel(grant.vesting_frequency)}
            </Badge>
            <Text size="xs" c="dimmed">
              {vested.toLocaleString()} / {grant.quantity.toLocaleString()} vested
            </Text>
          </Group>
          {hasStrike && (
            <Text size="xs" c="dimmed">
              Vested value {formatCents(grossCents)} &middot; Exercise cost{' '}
              {formatCents(exerciseCents)}
            </Text>
          )}
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <MoneyText cents={netCents} fw={700} size="sm" />
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * A single grant, rendered as a dense table-like row from the `sm` breakpoint up
 * and as a compact bordered card below it.
 */
function GrantItem(props: GrantItemProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <GrantRow {...props} /> : <GrantCard {...props} />
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
          <GrantItem
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
        <AddButton label="Add grant" onClick={() => startAdding(true)} />
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
    <PageSection
      title="Equity"
      intro="Each member’s startup equity grants, vesting after a cliff. The vested value — options at their gain over the strike, shares at the price per share — counts toward household net worth. Keep the price per share current yourself."
    >
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
    </PageSection>
  )
}
