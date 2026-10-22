import { Badge, Group, Stack, Text } from '@mantine/core'
import {
  exerciseCostCents,
  grantValueCents,
  grossVestedValueCents,
  heldShareQuantity,
  vestedQuantity,
} from '@nest/plan'
import type { EquityExerciseInput, EquityExerciseRow } from '../hooks/useEquityExercises'
import type { EquityGrantInput, EquityGrantRow } from '../hooks/useEquityGrants'
import type { EquitySaleInput, EquitySaleRow } from '../hooks/useEquitySales'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate } from '../lib/dates'
import { EQUITY_INSTRUMENT_TYPES, equityGrantToPlan, VESTING_FREQUENCIES } from '../lib/equity'
import { formatCents } from '../lib/money'
import { AppCard } from './AppCard'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { EquityExerciseForm } from './EquityExerciseForm'
import { EquityGrantForm } from './EquityGrantForm'
import { EquitySaleForm } from './EquitySaleForm'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

interface EquityScreenProps {
  members: Member[]
  grants: EquityGrantRow[]
  exercises: EquityExerciseRow[]
  sales: EquitySaleRow[]
  /** The reporting date grants are valued as of. */
  asOf: Date
  onCreate: (input: EquityGrantInput) => Promise<void>
  onUpdate: (id: string, input: EquityGrantInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCreateExercise: (input: EquityExerciseInput) => Promise<void>
  onUpdateExercise: (id: string, input: EquityExerciseInput) => Promise<void>
  onDeleteExercise: (id: string) => Promise<void>
  onCreateSale: (input: EquitySaleInput) => Promise<void>
  onUpdateSale: (id: string, input: EquitySaleInput) => Promise<void>
  onDeleteSale: (id: string) => Promise<void>
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
  exercises: EquityExerciseRow[]
  sales: EquitySaleRow[]
  asOf: Date
  onEdit: () => void
  onDelete: () => void
}

/**
 * A grant's derived facts: its vested quantity, net value, option breakdown, and
 * the units exercised, held, and sold.
 */
function grantFacts(
  grant: EquityGrantRow,
  exercises: EquityExerciseRow[],
  sales: EquitySaleRow[],
  asOf: Date,
) {
  const planGrant = equityGrantToPlan(grant, exercises, sales)
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
    activity: activityCaption(
      planGrant.exercisedQuantity ?? 0,
      planGrant.soldQuantity ?? 0,
      heldShareQuantity(planGrant, asOf),
    ),
  }
}

/** A line naming the units exercised, held, and sold, or undefined when none has moved. */
function activityCaption(exercised: number, sold: number, held: number): string | undefined {
  const parts = [
    exercised > 0 ? `${exercised.toLocaleString()} exercised` : null,
    sold > 0 ? `${sold.toLocaleString()} sold` : null,
    exercised > 0 || sold > 0 ? `${held.toLocaleString()} shares held` : null,
  ].filter((part) => part !== null)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * One grant as a dense table-like row for desktop: the label grows with its
 * instrument and vesting-frequency badges beside it, the vested quantity and net
 * value right-aligned in fixed columns, the controls at the end, and an option
 * grant's gross value and exercise cost on the caption line beneath.
 */
function GrantRow({ grant, exercises, sales, asOf, onEdit, onDelete }: GrantItemProps) {
  const { vested, grossCents, exerciseCents, netCents, hasStrike, activity } = grantFacts(
    grant,
    exercises,
    sales,
    asOf,
  )
  const caption = [
    hasStrike
      ? `Vested value ${formatCents(grossCents)} · Exercise cost ${formatCents(exerciseCents)}`
      : null,
    activity ?? null,
  ]
    .filter((part) => part !== null)
    .join(' — ')
  return (
    <ListRow gap="sm" caption={caption === '' ? undefined : caption}>
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
        <Badge size="xs" variant="default">
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
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
function GrantCard({ grant, exercises, sales, asOf, onEdit, onDelete }: GrantItemProps) {
  const { vested, grossCents, exerciseCents, netCents, hasStrike, activity } = grantFacts(
    grant,
    exercises,
    sales,
    asOf,
  )
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
            <Badge size="xs" variant="default">
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
          {activity && (
            <Text size="xs" c="dimmed">
              {activity}
            </Text>
          )}
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
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
  const wide = useIsWide()
  return wide ? <GrantRow {...props} /> : <GrantCard {...props} />
}

interface MemberEquityProps extends Omit<
  EquityScreenProps,
  'members' | 'grants' | 'exercises' | 'sales'
> {
  member: Member
  grants: EquityGrantRow[]
  exercises: EquityExerciseRow[]
  sales: EquitySaleRow[]
}

/** One recorded exercise or sale as a compact bordered card. */
function ActivityCard({
  title,
  detail,
  onEdit,
  onDelete,
}: {
  title: string
  detail: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {title}
          </Text>
          <Text size="xs" c="dimmed">
            {detail}
          </Text>
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/** A member's equity grants, with their exercises and sales, each with inline add/edit forms. */
function MemberEquity({
  member,
  grants,
  exercises,
  sales,
  asOf,
  onCreate,
  onUpdate,
  onDelete,
  onCreateExercise,
  onUpdateExercise,
  onDeleteExercise,
  onCreateSale,
  onUpdateSale,
  onDeleteSale,
}: MemberEquityProps) {
  const grantLabel = (id: string) => grants.find((grant) => grant.id === id)?.label ?? 'Grant'
  const optionGrants = grants.filter((grant) => grant.instrument_type === 'option')
  const memberExercises = exercises.filter((exercise) => exercise.member_id === member.id)
  const memberSales = sales.filter((sale) => sale.member_id === member.id)

  return (
    <Stack gap="xs">
      <Text fw={600}>{member.name}</Text>

      <EditableList<EquityGrantRow, EquityGrantInput>
        items={grants}
        addLabel="Add grant"
        emptyMessage="No grants yet."
        deleteTarget={(grant) => ({ title: 'Delete grant?', itemLabel: grant.label })}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        renderItem={(grant, { onEdit, onDelete: onDeleteItem }) => (
          <GrantItem
            grant={grant}
            exercises={exercises}
            sales={sales}
            asOf={asOf}
            onEdit={onEdit}
            onDelete={onDeleteItem}
          />
        )}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <EquityGrantForm
            member={member}
            initial={initial}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        )}
      />

      {optionGrants.length > 0 && (
        <Stack gap="xs">
          <Text fw={600} size="sm" c="dimmed">
            Exercises
          </Text>
          <EditableList<EquityExerciseRow, EquityExerciseInput>
            items={memberExercises}
            addLabel="Record exercise"
            emptyMessage="No exercises recorded."
            deleteTarget={(exercise) => ({
              title: 'Delete exercise?',
              itemLabel: `${grantLabel(exercise.grant_id)} exercise`,
            })}
            onCreate={onCreateExercise}
            onUpdate={onUpdateExercise}
            onDelete={onDeleteExercise}
            renderItem={(exercise, { onEdit, onDelete: onDeleteItem }) => (
              <ActivityCard
                title={`${exercise.quantity.toLocaleString()} × ${grantLabel(exercise.grant_id)}`}
                detail={[
                  formatIsoDate(exercise.exercised_on),
                  `strike ${formatCents(exercise.strike_price_cents)}`,
                  exercise.market_price_per_share_cents === null
                    ? null
                    : `market ${formatCents(exercise.market_price_per_share_cents)}`,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
                onEdit={onEdit}
                onDelete={onDeleteItem}
              />
            )}
            renderForm={({ initial, onSubmit, onCancel }) => (
              <EquityExerciseForm
                member={member}
                grants={optionGrants}
                exercises={exercises}
                sales={sales}
                initial={initial}
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            )}
          />
        </Stack>
      )}

      {grants.length > 0 && (
        <Stack gap="xs">
          <Text fw={600} size="sm" c="dimmed">
            Sales
          </Text>
          <EditableList<EquitySaleRow, EquitySaleInput>
            items={memberSales}
            addLabel="Record sale"
            emptyMessage="No sales recorded."
            deleteTarget={(sale) => ({
              title: 'Delete sale?',
              itemLabel: `${grantLabel(sale.grant_id)} sale`,
            })}
            onCreate={onCreateSale}
            onUpdate={onUpdateSale}
            onDelete={onDeleteSale}
            renderItem={(sale, { onEdit, onDelete: onDeleteItem }) => (
              <ActivityCard
                title={`${sale.quantity.toLocaleString()} × ${grantLabel(sale.grant_id)}`}
                detail={[
                  formatIsoDate(sale.sold_on),
                  `${formatCents(sale.price_per_share_cents)} per share`,
                  sale.fee_cents > 0 ? `fees ${formatCents(sale.fee_cents)}` : null,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
                onEdit={onEdit}
                onDelete={onDeleteItem}
              />
            )}
            renderForm={({ initial, onSubmit, onCancel }) => (
              <EquitySaleForm
                member={member}
                grants={grants}
                exercises={exercises}
                sales={sales}
                initial={initial}
                onSubmit={onSubmit}
                onCancel={onCancel}
              />
            )}
          />
        </Stack>
      )}
    </Stack>
  )
}

/**
 * Presentational equity manager: one grouped list of grants per household member,
 * each grant showing its vesting schedule, vested quantity, and current value,
 * with the member's option exercises and share sales beneath. Only unexercised
 * options count as options; exercised shares still held are valued as shares and
 * sold shares leave the holding. The value counts toward net worth as an asset.
 * Sales are capital-gains events in the tax estimate. Persistence lives in the
 * caller.
 */
export function EquityScreen({
  members,
  grants,
  exercises,
  sales,
  ...handlers
}: EquityScreenProps) {
  return (
    <PageSection
      title="Equity"
      intro="Each member’s startup equity grants, vesting after a cliff. Unexercised vested options are valued at their gain over the strike; exercised shares still held at the price per share; sold shares leave your holdings. The value counts toward household net worth. Keep the price per share current yourself."
    >
      {members.map((member) => (
        <MemberEquity
          key={member.id}
          member={member}
          grants={grants.filter((grant) => grant.member_id === member.id)}
          exercises={exercises}
          sales={sales}
          {...handlers}
        />
      ))}
    </PageSection>
  )
}
