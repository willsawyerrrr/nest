import { Badge, Box, Group, Stack, Text } from '@mantine/core'
import { fortnightlyCents } from '@nest/plan'
import { annualGrossCents } from '@nest/tax'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type { Inflow, InflowInput } from '../hooks/useInflows'
import { useInlineEditing } from '../hooks/useInlineEditing'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate, todayIso } from '../lib/dates'
import { formatFrequency } from '../lib/frequency'
import { inflowTypeLabel } from '../lib/inflowTypes'
import { memberName } from '../lib/members'
import { formatCents } from '../lib/money'
import { toIncomeInput } from '../lib/tax'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { EmptyState } from './EmptyState'
import { FortnightlyAmount } from './FortnightlyAmount'
import { InflowForm } from './InflowForm'
import { ListRow } from './ListRow'

interface InflowListProps {
  inflows: Inflow[]
  members: Member[]
  onCreate: (input: InflowInput) => Promise<void>
  onUpdate: (id: string, input: InflowInput) => Promise<void>
  onDelete: (id: string) => void
}

/** Describes an inflow's entered amount: a flat amount, or a wage's rate × hours. */
function describeAmount(inflow: Inflow): string {
  if (inflow.type === 'wage') {
    const rate = formatCents(inflow.hourly_rate_cents ?? 0)
    return `${rate} × ${inflow.hours_per_period ?? 0} hrs`
  }
  return formatCents(inflow.amount_cents ?? 0)
}

/** The inflow's fortnightly-normalised gross, via its annualised gross. */
function fortnightlyOf(inflow: Inflow): number {
  return fortnightlyCents(annualGrossCents(toIncomeInput(inflow)), 'annual')
}

/**
 * A dimmed caption describing an inflow's effective window (e.g.
 * "1 Jul 2026 – 14 Sep 2026", "from 15 Sep 2026", "until 30 Jun 2027"), or null
 * when it applies all year. This is a per-inflow annotation only; the FY-prorated
 * gross it implies is a Tax-tab concept, not the displayed steady-rate figure.
 */
function effectiveDatesCaption(inflow: Inflow): string | null {
  if (inflow.starts_on && inflow.ends_on) {
    return `${formatIsoDate(inflow.starts_on)} – ${formatIsoDate(inflow.ends_on)}`
  }
  if (inflow.starts_on) {
    return `from ${formatIsoDate(inflow.starts_on)}`
  }
  if (inflow.ends_on) {
    return `until ${formatIsoDate(inflow.ends_on)}`
  }
  return null
}

/**
 * Whether an inflow's effective window has closed: it has an `ends_on` date that
 * fell strictly before today. Compared date-only (both are `YYYY-MM-DD`), so an
 * inflow ending today still counts as active on its last day.
 */
function isInflowEnded(inflow: Inflow, now: Date = new Date()): boolean {
  return inflow.ends_on !== null && inflow.ends_on < todayIso(now)
}

/**
 * The dimmed row subtitle: the type label, prefixed by the member (for a
 * member-tagged taxable inflow) or a "Non-taxable" marker. Taxable is the expected
 * default and is not labelled, so a taxable inflow with no member shows just the
 * type.
 */
function inflowSubtitle(inflow: Inflow, memberName: (id: string) => string): string {
  const type = inflowTypeLabel(inflow.type)
  if (!inflow.taxable) {
    return `Non-taxable · ${type}`
  }
  return inflow.member_id ? `${memberName(inflow.member_id)} · ${type}` : type
}

/**
 * One inflow as a single dense table-like row for desktop: the name grows to
 * fill, with the member/taxability as a dimmed suffix beside it, then the entered
 * amount, frequency, and fortnightly figure right-aligned in fixed columns, with
 * the controls at the end and a light rule rather than a bordered card so many
 * inflows fit and scan as a table. The type is dropped here for space (it stays
 * on the mobile card and in the edit form).
 */
function InflowRow({
  inflow,
  memberName,
  onEdit,
  onDelete,
}: {
  inflow: Inflow
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const ended = isInflowEnded(inflow)
  return (
    <ListRow
      data-testid="inflow-row"
      gap="sm"
      dimmed={ended}
      caption={ended ? undefined : (effectiveDatesCaption(inflow) ?? undefined)}
    >
      <Group gap={6} wrap="nowrap" align="baseline" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
          {inflow.name}
        </Text>
        {ended && (
          <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
            Inactive
          </Badge>
        )}
        <Text size="xs" c="dimmed" truncate style={{ flexShrink: 0, maxWidth: '12rem' }}>
          {inflowSubtitle(inflow, memberName)}
        </Text>
      </Group>
      <Text size="sm" c="dimmed" ta="right" truncate style={{ width: '7rem', flexShrink: 0 }}>
        {describeAmount(inflow)}
      </Text>
      <Box style={{ width: '8rem', flexShrink: 0, textAlign: 'right' }}>
        <Badge size="xs" variant="default">
          {formatFrequency(inflow.schedule, inflow.interval_count)}
        </Badge>
      </Box>
      <FortnightlyAmount
        cents={fortnightlyOf(inflow)}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One inflow as a compact bordered card for mobile: name stacked over its facts. */
function InflowCard({
  inflow,
  memberName,
  onEdit,
  onDelete,
}: {
  inflow: Inflow
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const ended = isInflowEnded(inflow)
  return (
    <AppCard withBorder padding="xs" style={ended ? { opacity: 0.55 } : undefined}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={600} size="sm" truncate style={{ minWidth: 0 }}>
              {inflow.name}
            </Text>
            {ended && (
              <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
                Inactive
              </Badge>
            )}
          </Group>
          <Group gap={6} wrap="wrap">
            {inflow.member_id && (
              <Text size="xs" c="dimmed">
                {memberName(inflow.member_id)}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {describeAmount(inflow)}
            </Text>
            {!inflow.taxable && (
              <Badge size="xs" variant="light" color="gray">
                Non-taxable
              </Badge>
            )}
            <Badge size="xs" variant="light" color="grape">
              {inflowTypeLabel(inflow.type)}
            </Badge>
            <Badge size="xs" variant="default">
              {formatFrequency(inflow.schedule, inflow.interval_count)}
            </Badge>
          </Group>
          {!ended && effectiveDatesCaption(inflow) && (
            <Text size="xs" c="dimmed">
              {effectiveDatesCaption(inflow)}
            </Text>
          )}
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <FortnightlyAmount cents={fortnightlyOf(inflow)} />
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * A single inflow, rendered as a dense table-like row from the `sm` breakpoint up
 * and as a compact bordered card below it.
 */
function InflowItem(props: {
  inflow: Inflow
  memberName: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const wide = useIsWide()
  return wide ? <InflowRow {...props} /> : <InflowCard {...props} />
}

/** The household's inflows with an add affordance and inline add/edit forms. */
export function InflowList({ inflows, members, onCreate, onUpdate, onDelete }: InflowListProps) {
  const { editingId, adding, startAdding, startEditing, close: closeForms } = useInlineEditing()
  const { confirm, modal } = useConfirmDelete()
  // Inactive (ended) inflows sink to the bottom; the sort is stable, so the order
  // within the active and inactive groups is otherwise preserved.
  const ordered = [...inflows].sort((a, b) => Number(isInflowEnded(a)) - Number(isInflowEnded(b)))

  return (
    <Stack gap="sm">
      {inflows.length === 0 && !adding ? (
        <EmptyState>No inflows yet. Add one to get started.</EmptyState>
      ) : (
        ordered.map((inflow) =>
          editingId === inflow.id ? (
            <InflowForm
              key={inflow.id}
              members={members}
              initial={inflow}
              onSubmit={async (input) => {
                await onUpdate(inflow.id, input)
                closeForms()
              }}
              onCancel={closeForms}
            />
          ) : (
            <InflowItem
              key={inflow.id}
              inflow={inflow}
              memberName={(id) => memberName(members, id)}
              onEdit={() => startEditing(inflow.id)}
              onDelete={() =>
                confirm({
                  title: 'Delete inflow?',
                  itemLabel: inflow.name,
                  onConfirm: () => onDelete(inflow.id),
                })
              }
            />
          ),
        )
      )}

      {adding ? (
        <InflowForm
          members={members}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <AddButton label="Add inflow" onClick={() => startAdding(true)} />
      )}

      {modal}
    </Stack>
  )
}
