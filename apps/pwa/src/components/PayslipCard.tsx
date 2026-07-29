import { Anchor, Collapse, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type {
  PartCycleReason,
  PayslipLineGroupVariance,
  PayslipTaxGroupVariance,
  PayslipVariance,
} from '@nest/plan'
import type { PayslipRow } from '../hooks/usePayslips'
import { formatIsoDate } from '../lib/dates'
import { moneyColor } from '../lib/money'
import { periodLabel } from '../lib/payslips'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { MoneyText } from './MoneyText'

/**
 * A figure's variance against the plan: its size in the app's sign colouring with
 * the direction spelled out, so a tint is never read alone. `null` means nothing
 * on the payslip maps to a projection, which is stated rather than shown as a
 * zero or a bare dash.
 *
 * Colour follows the money sign of the variance itself: above plan reads
 * positive, below plan negative. That is the right reading for withholding too —
 * more tax withheld than the estimate implies is a larger refund at year end,
 * not a problem, while withholding less than the liability is what leaves a bill
 * to pay.
 */
function VarianceNote({ varianceCents }: { varianceCents: number | null }) {
  if (varianceCents === null) {
    return (
      <Text size="xs" c="dimmed">
        No projection to compare
      </Text>
    )
  }
  if (varianceCents === 0) {
    return (
      <Text size="xs" c="dimmed">
        On plan
      </Text>
    )
  }
  const color = moneyColor(varianceCents)
  return (
    <Text size="xs" {...(color !== undefined && { c: color })}>
      <MoneyText span cents={Math.abs(varianceCents)} />
      {varianceCents > 0 ? ' above plan' : ' below plan'}
    </Text>
  )
}

/**
 * One of a payslip's figures: its label, the amount, and any variance beneath.
 * A member's year-to-date grid on the payslips screen builds its cells from the
 * same primitive, so a total reads exactly as the per-slip figure it sums.
 */
export function FigureCell({
  label,
  cents,
  varianceCents,
}: {
  label: string
  cents: number
  varianceCents?: number | null
}) {
  return (
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <MoneyText cents={cents} fw={600} size="sm" />
      {varianceCents !== undefined && <VarianceNote varianceCents={varianceCents} />}
    </Stack>
  )
}

/**
 * One inflow's share of an itemised slip: the lines drawing on it named and
 * summed, against what that projection expected for the period. A group mapped to
 * no inflow — or to one since retired — has nothing to compare, which
 * {@link VarianceNote} says rather than showing a zero.
 */
function LineGroupRow({
  group,
  inflowName,
}: {
  group: PayslipLineGroupVariance
  inflowName?: string | undefined
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="xs" fw={500}>
          {inflowName ?? 'Not mapped to an inflow'}
        </Text>
        <Text size="xs" c="dimmed">
          {group.labels.join(', ')}
        </Text>
      </Stack>
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <MoneyText cents={group.actualCents} size="xs" fw={600} />
        <VarianceNote varianceCents={group.varianceCents} />
      </Group>
    </Group>
  )
}

/**
 * An itemised slip broken down by the inflow each earning draws on, so a steady
 * salary's nil variance and a lumpy allowance's are read apart rather than summed
 * into one gross figure. Gross the lines do not account for is called out: it is
 * real earnings nobody has attributed, and it lands in the gross variance above.
 */
function LineGroups({
  groups,
  unallocatedCents,
  inflowNames,
}: {
  groups: readonly PayslipLineGroupVariance[]
  unallocatedCents: number
  inflowNames: ReadonlyMap<string, string>
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        Earnings lines
      </Text>
      {groups.map((group) => (
        <LineGroupRow
          key={group.sourceInflowId ?? 'unmapped'}
          group={group}
          {...(group.sourceInflowId !== null && {
            inflowName: inflowNames.get(group.sourceInflowId),
          })}
        />
      ))}
      {unallocatedCents !== 0 && (
        <Text size="xs" c="dimmed">
          <MoneyText span cents={Math.abs(unallocatedCents)} />{' '}
          {unallocatedCents > 0
            ? 'of the gross is not itemised.'
            : 'more than the gross is itemised.'}
        </Text>
      )}
    </Stack>
  )
}

/**
 * What to make of plan figures that are a share of a pay period rather than a whole
 * one, one note per reason they are — because the two readings could hardly be
 * further apart. A period that is not a whole turn of the cycle really does carry a
 * fraction of a period's pay, so its figures are worth reading as approximate. A
 * whole period whose projection changed partway through is the opposite: each share
 * is exact and the shares sum back to the whole, so a variance against one of them
 * is a real gap rather than an artefact of the split, and saying "only part of a
 * turn" there would talk a member out of trusting a figure that is precisely right.
 */
const PART_CYCLE_NOTES: Readonly<Record<PartCycleReason, string>> = {
  part_period:
    'This period is only part of a turn of the pay cycle its earnings are drawn on, so the plan figures are that share of a whole pay period.',
  inflow_dates:
    'This period is a whole turn of the pay cycle, but the projection behind it changed partway through — usually a pay rise, entered as the old rate ending and the new one starting — so each rate’s plan figures are exactly its share, and the shares add up to a whole pay period.',
}

/** What a tax line pays, as the slip's own TAX section names it. */
const TAX_COMPONENT_LABELS: Readonly<Record<PayslipTaxGroupVariance['component'], string>> = {
  payg: 'PAYG income tax',
  stsl: 'STSL (study loan)',
}

/**
 * A slip's tax split by the part of the liability each withholding pays, so a
 * study-loan component that is short cannot hide behind income tax that is over.
 * Tax the lines do not account for is called out: the printed total above is what
 * the year's refund or bill is worked out from, so a remainder is withholding
 * nobody has attributed rather than a figure being ignored.
 */
function TaxGroups({
  groups,
  unallocatedCents,
}: {
  groups: readonly PayslipTaxGroupVariance[]
  unallocatedCents: number
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        Tax lines
      </Text>
      {groups.map((group) => (
        <Group key={group.component} justify="space-between" wrap="nowrap" gap="xs">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="xs" fw={500}>
              {TAX_COMPONENT_LABELS[group.component]}
            </Text>
            <Text size="xs" c="dimmed">
              {group.labels.join(', ')}
            </Text>
          </Stack>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <MoneyText cents={group.actualCents} size="xs" fw={600} />
            <VarianceNote varianceCents={group.varianceCents} />
          </Group>
        </Group>
      ))}
      {unallocatedCents !== 0 && (
        <Text size="xs" c="dimmed">
          <MoneyText span cents={Math.abs(unallocatedCents)} />{' '}
          {unallocatedCents > 0
            ? 'of the tax withheld is not itemised.'
            : 'more than the tax withheld is itemised.'}
        </Text>
      )}
    </Stack>
  )
}

/** A link opening a payslip's stored document, which is fetched through a signed URL. */
function DocumentLink({ path, onView }: { path: string; onView: (path: string) => void }) {
  return (
    <Anchor
      size="xs"
      component="button"
      type="button"
      onClick={() => onView(path)}
      style={{ alignSelf: 'flex-start' }}
    >
      View payslip document
    </Anchor>
  )
}

/**
 * The variance a collapsed card leads with, and which figure it belongs to: the
 * largest of the slip's three by size, so a withholding or super gap on a slip
 * whose gross landed on plan is noticed without opening it. Gross wins a tie, so a
 * slip on plan throughout reads against the figure the projection projects — and a
 * slip mapped to no projection at all says so, since nothing else outranks it.
 *
 * Neither unallocated remainder competes here. Gross the earnings lines miss is
 * already in the gross variance, and tax the tax lines miss does not change the
 * printed total the year's refund or bill is worked out from: both are
 * itemisation gaps rather than pay off plan, so they wait in the detail.
 */
function headlineVariance(variance: PayslipVariance): {
  label: string
  varianceCents: number | null
} {
  // A figure with no projection to compare has no size, so it leads only when
  // nothing else deviates.
  const size = (varianceCents: number | null) => Math.abs(varianceCents ?? 0)
  const figures = [
    { label: 'Gross', varianceCents: variance.grossVarianceCents },
    { label: 'Tax withheld', varianceCents: variance.taxWithheldVarianceCents },
    { label: 'Super', varianceCents: variance.superVarianceCents },
  ]
  return figures.reduce((leader, figure) =>
    size(figure.varianceCents) > size(leader.varianceCents) ? figure : leader,
  )
}

/**
 * The slip's gross as a collapsed card leads with it, labelled so the figure
 * cannot be read as the net.
 */
function HeadlineGross({ payslip }: { payslip: PayslipRow }) {
  return (
    <Group gap={4} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
      <Text size="xs" c="dimmed">
        Gross
      </Text>
      <MoneyText cents={payslip.gross_cents} fw={600} size="sm" />
    </Group>
  )
}

/**
 * The variance a collapsed card leads with, named where it is not the gross one so
 * the reading is never taken for the gross figure above it. A named variance is the
 * widest thing the header carries, so it takes a line of its own rather than crowd
 * the pay period off a phone.
 */
function HeadlineVarianceNote({ variance }: { variance: PayslipVariance }) {
  const headline = headlineVariance(variance)
  return (
    <Group gap={4} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
      {headline.label !== 'Gross' && (
        <Text size="xs" c="dimmed">
          {headline.label}
        </Text>
      )}
      <VarianceNote varianceCents={headline.varianceCents} />
    </Group>
  )
}

interface PayslipCardProps {
  payslip: PayslipRow
  variance: PayslipVariance
  /** Every inflow's name keyed by id, for naming each earnings-line group. */
  inflowNames: ReadonlyMap<string, string>
  onEdit: () => void
  onDelete: () => void
  onViewDocument: (path: string) => void
}

/**
 * One payslip, collapsed to a scannable row and expandable to its full detail. A
 * household enters a slip a fortnight, so the row a card settles at names the pay
 * period, the date the pay landed, and the gross with the slip's most notable
 * variance — enough to find a slip and read whether it went to plan without opening
 * it. The three stack rather than share a line: on a phone the period, a labelled
 * figure, and a named variance cannot sit side by side without one of them being
 * cut, and the money right-aligns so a column of grosses reads down the list.
 *
 * Expanding it adds the gross / withheld / super / net quartet each with its own
 * variance, the per-inflow and per-component breakdowns of its lines, and its note
 * and stored document. The figure grid reflows from two columns on a phone to four
 * from the `xs` breakpoint up — a payslip carries four figures and three variances,
 * more than a single dense row can hold — and the headline gives way to it, since
 * the grid states the same gross and variance in full. Expectations that are a share
 * of a pay period rather than the whole of one carry the note for the reason they are
 * — see {@link PART_CYCLE_NOTES} — read from the cycle the slip's own withholding and
 * super expectations rest on, since those are the figures the note is about. An
 * earnings group on some other cadence carries its own reason on its variance, and
 * its row already shows the variance that reason produced.
 *
 * Editing and deleting sit outside the disclosure: correcting a slip is no reason
 * to read it. Expansion is per card and lasts as long as the tab is open, which is
 * as long as the reading that prompted it.
 */
export function PayslipCard({
  payslip,
  variance,
  inflowNames,
  onEdit,
  onDelete,
  onViewDocument,
}: PayslipCardProps) {
  const [expanded, { toggle }] = useDisclosure(false)
  const detailId = `payslip-detail-${payslip.id}`

  return (
    <AppCard withBorder padding="xs">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <UnstyledButton
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls={detailId}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Stack gap={2}>
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                <Text fw={600} size="sm" truncate>
                  {periodLabel(payslip)}
                </Text>
              </Group>
              {(payslip.paid_on !== null || !expanded) && (
                <Group gap="sm" wrap="nowrap">
                  {payslip.paid_on !== null && (
                    <Text size="xs" c="dimmed" truncate>
                      Paid {formatIsoDate(payslip.paid_on)}
                    </Text>
                  )}
                  {!expanded && <HeadlineGross payslip={payslip} />}
                </Group>
              )}
              {!expanded && <HeadlineVarianceNote variance={variance} />}
            </Stack>
          </UnstyledButton>
          <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          </Group>
        </Group>

        <Collapse expanded={expanded} id={detailId}>
          <Stack gap={6}>
            <SimpleGrid cols={{ base: 2, xs: 4 }} spacing="xs">
              <FigureCell
                label="Gross"
                cents={payslip.gross_cents}
                varianceCents={variance.grossVarianceCents}
              />
              <FigureCell
                label="Tax withheld"
                cents={payslip.tax_withheld_cents}
                varianceCents={variance.taxWithheldVarianceCents}
              />
              <FigureCell
                label="Super"
                cents={variance.actualSuperCents}
                varianceCents={variance.superVarianceCents}
              />
              <FigureCell label="Net" cents={payslip.net_cents} />
            </SimpleGrid>

            {variance.lineGroups.length > 0 && (
              <LineGroups
                groups={variance.lineGroups}
                unallocatedCents={variance.unallocatedCents}
                inflowNames={inflowNames}
              />
            )}

            {variance.taxGroups.length > 0 && (
              <TaxGroups
                groups={variance.taxGroups}
                unallocatedCents={variance.unallocatedTaxCents}
              />
            )}

            {variance.partCycleReason !== null && (
              <Text size="xs" c="dimmed">
                {PART_CYCLE_NOTES[variance.partCycleReason]}
              </Text>
            )}

            {payslip.note !== null && (
              <Text size="xs" c="dimmed">
                {payslip.note}
              </Text>
            )}

            {payslip.file_path !== null && (
              <DocumentLink path={payslip.file_path} onView={onViewDocument} />
            )}
          </Stack>
        </Collapse>
      </Stack>
    </AppCard>
  )
}
