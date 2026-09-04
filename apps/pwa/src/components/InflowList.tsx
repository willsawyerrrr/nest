import { Badge, Box, Group, Stack, Text, type GroupProps } from '@mantine/core'
import { fortnightlyCents } from '@nest/plan'
import { annualGrossCents } from '@nest/tax'
import type { Inflow, InflowInput } from '../hooks/useInflows'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate, todayIso } from '../lib/dates'
import { formatFrequency } from '../lib/frequency'
import { inflowTypeLabel, oneOffTaxTreatmentLabel } from '../lib/inflowTypes'
import { memberName } from '../lib/members'
import { formatCents } from '../lib/money'
import { toIncomeInput } from '../lib/tax'
import { AppCard } from './AppCard'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
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

/**
 * The inflow's fortnightly-normalised gross, via its annualised gross — or null for a
 * ONE-OFF, which has no fortnightly reading at all. Dividing a payment that lands
 * once by 26 states a figure 25 fortnights of the year never see, which is the very
 * claim a one-off exists to stop the plan making.
 */
function fortnightlyOf(inflow: Inflow): number | null {
  return inflow.paid_on != null
    ? null
    : fortnightlyCents(annualGrossCents(toIncomeInput(inflow)), 'annual')
}

/**
 * The cadence badge an inflow carries: the period its amount is expressed over, or
 * `One-off` for a payment that names a date instead of a cadence.
 */
function cadenceLabel(inflow: Inflow): string {
  return inflow.schedule === null
    ? 'One-off'
    : formatFrequency(inflow.schedule, inflow.interval_count)
}

/**
 * How often the money arrives, where that is not the period the amount is expressed
 * over — "Paid fortnightly" beside an amount stated per year — and null where the two
 * are the same and the frequency badge already says it. The badge names the amount's
 * period, which is what the figure beside it covers, so the pay cycle needs saying
 * separately or a yearly salary paid fortnightly reads as arriving once a year.
 */
function payCadenceLabel(inflow: Inflow): string | null {
  if (
    inflow.pay_schedule === null ||
    (inflow.pay_schedule === inflow.schedule && inflow.pay_interval_count === inflow.interval_count)
  ) {
    return null
  }
  return `Paid ${formatFrequency(inflow.pay_schedule, inflow.pay_interval_count).toLowerCase()}`
}

/**
 * That the money lands in only some pay periods, where it does — on-call pay riding
 * the fortnightly payrun for the fortnights a shift was worked. Null in the ordinary
 * case. Worth saying beside the figures because the fortnightly one is a whole year's
 * worth spread over the year, which is what the plan projects, rather than what any
 * one fortnight brings.
 */
function occasionalLabel(inflow: Inflow): string | null {
  return inflow.arrives_every_pay_period ? null : 'Only some pay periods'
}

/**
 * When a one-off's money lands, and — for a taxable one — the concession it is
 * assessed under, since that is what separates a redundancy from a bonus of the same
 * size. Null for a recurring inflow, whose cadence badge says what there is to say.
 */
function oneOffCaption(inflow: Inflow): string | null {
  if (inflow.paid_on == null) {
    return null
  }
  const paid = `One-off \u00b7 ${formatIsoDate(inflow.paid_on)}`
  return inflow.one_off_tax_treatment === null
    ? paid
    : `${paid} \u00b7 ${oneOffTaxTreatmentLabel(inflow.one_off_tax_treatment)}`
}

/**
 * That a joint inflow's income is split between the two partners, and in what
 * proportion — `member_split_percent`% to the member it names, the rest to the
 * other. Null for an inflow that is not joint.
 */
function jointCaption(inflow: Inflow): string | null {
  if (!inflow.is_joint || inflow.member_split_percent == null) {
    return null
  }
  return `Joint · ${inflow.member_split_percent}% / ${100 - inflow.member_split_percent}%`
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
 * The dimmed second line an inflow carries: how often its money arrives where the
 * frequency badge does not already say it, whether it arrives every such period, then
 * its effective window. Undefined when none applies, which is the ordinary case. All
 * are qualifications of the figures above rather than figures themselves, so they
 * share one quiet line.
 */
function inflowCaption(inflow: Inflow): string | undefined {
  const parts = [
    oneOffCaption(inflow),
    jointCaption(inflow),
    payCadenceLabel(inflow),
    occasionalLabel(inflow),
    effectiveDatesCaption(inflow),
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * Whether an inflow's money is all behind it: a recurring one whose effective window
 * has closed, or a one-off whose payment date has passed. Compared date-only (every
 * date here is `YYYY-MM-DD`), so an inflow ending today, and a one-off paid today,
 * both still count as live on their last day.
 *
 * A paid one-off sinks and dims for the same reason an ended inflow does: it is a
 * record of money already had rather than money still to plan around, and a household
 * that has been here a few years has more of those than of live inflows.
 */
function isInflowEnded(inflow: Inflow, now: Date = new Date()): boolean {
  const last = inflow.paid_on ?? inflow.ends_on
  return last !== null && last < todayIso(now)
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
 * The inflow's fortnightly figure, or — for a one-off — a dimmed note that it has
 * none. The plan reads in fortnights and this money does not, so the column says so
 * rather than leaving a blank a reader would take for nil.
 */
function InflowFortnightly({
  inflow,
  justify,
}: {
  inflow: Inflow
  justify?: GroupProps['justify']
}) {
  const cents = fortnightlyOf(inflow)
  if (cents === null) {
    return (
      <Text size="xs" c="dimmed" ta={justify === undefined ? undefined : 'right'}>
        Not fortnightly
      </Text>
    )
  }
  return <FortnightlyAmount cents={cents} {...(justify !== undefined && { justify })} />
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
      caption={ended ? undefined : inflowCaption(inflow)}
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
          {cadenceLabel(inflow)}
        </Badge>
      </Box>
      <Box style={{ width: '7rem', flexShrink: 0 }}>
        <InflowFortnightly inflow={inflow} justify="flex-end" />
      </Box>
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
            <Badge size="xs" variant="light" color="violet">
              {inflowTypeLabel(inflow.type)}
            </Badge>
            <Badge size="xs" variant="default">
              {cadenceLabel(inflow)}
            </Badge>
          </Group>
          {!ended && inflowCaption(inflow) && (
            <Text size="xs" c="dimmed">
              {inflowCaption(inflow)}
            </Text>
          )}
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <InflowFortnightly inflow={inflow} />
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
  // Inactive (ended) inflows sink to the bottom; the sort is stable, so the order
  // within the active and inactive groups is otherwise preserved.
  const ordered = [...inflows].sort((a, b) => Number(isInflowEnded(a)) - Number(isInflowEnded(b)))

  return (
    <Stack gap="sm">
      <EditableList<Inflow, InflowInput>
        items={ordered}
        addLabel="Add inflow"
        emptyMessage="No inflows yet. Add one to get started."
        deleteTarget={(inflow) => ({ title: 'Delete inflow?', itemLabel: inflow.name })}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        renderItem={(inflow, { onEdit, onDelete: onDeleteItem }) => (
          <InflowItem
            inflow={inflow}
            memberName={(id) => memberName(members, id)}
            onEdit={onEdit}
            onDelete={onDeleteItem}
          />
        )}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <InflowForm members={members} initial={initial} onSubmit={onSubmit} onCancel={onCancel} />
        )}
      />
    </Stack>
  )
}
