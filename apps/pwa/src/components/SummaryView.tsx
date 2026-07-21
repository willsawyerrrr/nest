import { Card, ColorSwatch, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { DonutChart } from '@mantine/charts'
import { useMediaQuery } from '@mantine/hooks'
import type { Amounts, BudgetSummary } from '@nest/plan'
import { formatCents, moneyColor } from '../lib/money'

interface SummaryViewProps {
  summary: BudgetSummary
}

const percent = new Intl.NumberFormat('en-AU', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** Formats a group's `portion` (a 0–1 share of available cash) as a percentage. */
function formatPortion(portion: number): string {
  return percent.format(portion)
}

/** A running line's portion: its fortnightly share of available cash (0 when available is 0). */
function runningPortion(amounts: Amounts, available: Amounts): number {
  return available.fortnightlyCents === 0
    ? 0
    : amounts.fortnightlyCents / available.fortnightlyCents
}

/** A group's totals plus its portion of available cash. */
interface GroupRow {
  label: string
  fortnightlyCents: number
  annualCents: number
  portion: number
}

/**
 * The six budget groups in reconciliation order, each with its human label and
 * the CSS colour its allocation segment takes in the donut. The colours ramp
 * teal → cyan → green, alternating a dark then light shade within each hue so
 * adjacent slices stay distinguishable.
 */
const GROUP_ORDER: { key: keyof BudgetSummary['groups']; label: string; color: string }[] = [
  { key: 'needs', label: 'Needs', color: 'var(--mantine-color-teal-8)' },
  { key: 'wants', label: 'Wants', color: 'var(--mantine-color-teal-5)' },
  { key: 'discretionary', label: 'Discretionary', color: 'var(--mantine-color-cyan-6)' },
  { key: 'temporary', label: 'Temporary', color: 'var(--mantine-color-cyan-4)' },
  { key: 'savings', label: 'Savings', color: 'var(--mantine-color-green-6)' },
  { key: 'investments', label: 'Investments', color: 'var(--mantine-color-green-4)' },
]

/** The keys of the groups that make up outgoings, in reconciliation order. */
const OUTGOING_KEYS: (keyof BudgetSummary['groups'])[] = [
  'needs',
  'wants',
  'discretionary',
  'temporary',
]

/** The colour of the leftover-buffer segment (After Saving) in the donut. */
const BUFFER_COLOR = 'var(--mantine-color-gray-5)'

/** A donut segment: an allocation slice with its label, amount, colour, and share. */
interface Segment {
  name: string
  value: number
  color: string
  portion: number
}

/**
 * The allocation segments for the donut: each non-empty group by its fortnightly
 * amount, plus a Buffer slice for a positive After Saving remainder. Empty groups
 * and a non-positive (over-allocated) buffer are omitted.
 */
function allocationSegments(summary: BudgetSummary): Segment[] {
  const segments: Segment[] = GROUP_ORDER.map(({ key, label, color }) => ({
    name: label,
    value: summary.groups[key].fortnightlyCents,
    color,
    portion: summary.groups[key].portion,
  })).filter((segment) => segment.value > 0)

  const bufferCents = summary.afterSaving.fortnightlyCents
  const availableCents = summary.available.fortnightlyCents
  if (bufferCents > 0) {
    segments.push({
      name: 'Buffer',
      value: bufferCents,
      color: BUFFER_COLOR,
      portion: availableCents === 0 ? 0 : bufferCents / availableCents,
    })
  }
  return segments
}

/**
 * A compact stat tile: a dimmed label above its bold fortnightly value. When
 * `signed`, the value takes the money-sign colour (green positive, red negative).
 */
function TotalTile({
  label,
  cents,
  signed = false,
}: {
  label: string
  cents: number
  signed?: boolean
}) {
  return (
    <Stack gap={0} align="center">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} c={signed ? moneyColor(cents) : undefined}>
        {formatCents(cents)}
      </Text>
    </Stack>
  )
}

/**
 * A donut of how available fortnightly cash splits across the groups, with the
 * leftover buffer shown in the centre, a row of income/outgoing/remaining
 * totals, and a legend of each slice's share.
 */
function AllocationDonut({ summary }: { summary: BudgetSummary }) {
  const segments = allocationSegments(summary)
  if (segments.length === 0) {
    return null
  }

  return (
    <Card component="section" aria-label="Allocation" withBorder radius="md" p="md">
      <Stack gap="md" align="center">
        <Title order={3} size="h5" style={{ alignSelf: 'flex-start' }}>
          Fortnightly allocation
        </Title>
        <DonutChart
          data={segments.map(({ name, value, color }) => ({ name, value, color }))}
          size={180}
          thickness={28}
          withTooltip
          tooltipDataSource="segment"
          valueFormatter={formatCents}
          chartLabel={`${formatCents(summary.afterSaving.fortnightlyCents)} buffer`}
        />
        <SimpleGrid cols={3} spacing="xs" w="100%">
          <TotalTile label="Income" cents={summary.available.fortnightlyCents} />
          <TotalTile label="Outgoing" cents={summary.outgoings.fortnightlyCents} />
          <TotalTile label="Remaining" cents={summary.afterSaving.fortnightlyCents} signed />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" verticalSpacing={4} w="100%">
          {segments.map((segment) => (
            <Group key={segment.name} gap={8} wrap="nowrap">
              <ColorSwatch color={segment.color} size={12} withShadow={false} />
              <Text size="sm" style={{ flex: 1 }}>
                {segment.name}
              </Text>
              <Text size="sm" c="dimmed">
                {formatPortion(segment.portion)}
              </Text>
            </Group>
          ))}
        </SimpleGrid>
      </Stack>
    </Card>
  )
}

/**
 * One reconciliation line as a compact ledger row: the label on the left and,
 * inline on the right, the fortnightly amount (emphasised) with the portion
 * trailing as a smaller dimmed figure — each its own text node. The annual
 * figure is dropped on narrow screens so the label keeps its width rather than
 * truncating; it remains in the wide-screen table. Running figures (Available /
 * After Outgoing / After Saving) get a tinted background and a bolder label to
 * stand out from the group lines.
 */
function ReconRow({
  label,
  amounts,
  portion,
  running = false,
  signed = false,
}: {
  label: string
  amounts: Amounts
  portion: number
  running?: boolean
  signed?: boolean
}) {
  return (
    <Group
      component="section"
      aria-label={label}
      justify="space-between"
      wrap="nowrap"
      gap="sm"
      p="xs"
      bg={running ? 'var(--mantine-primary-color-light)' : undefined}
      style={{ borderRadius: 'var(--mantine-radius-sm)' }}
    >
      <Text size="sm" fw={running ? 700 : 400} truncate style={{ flex: 1, minWidth: 0 }}>
        {label}
      </Text>
      <Group gap="sm" wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
        <Text
          fw={700}
          size="sm"
          w={92}
          ta="right"
          c={signed ? moneyColor(amounts.fortnightlyCents) : undefined}
        >
          {formatCents(amounts.fortnightlyCents)}
        </Text>
        <Text fw={700} size="xs" c="dimmed" w={48} ta="right">
          {formatPortion(portion)}
        </Text>
      </Group>
    </Group>
  )
}

/** One running figure's row in the wide-screen table, with its portion. */
function RunningRow({
  label,
  amounts,
  portion,
  signed = false,
}: {
  label: string
  amounts: Amounts
  portion: number
  signed?: boolean
}) {
  return (
    <Table.Tr bg="var(--mantine-primary-color-light)">
      <Table.Th scope="row">{label}</Table.Th>
      <Table.Td fw={700} c={signed ? moneyColor(amounts.fortnightlyCents) : undefined}>
        {formatCents(amounts.fortnightlyCents)}
      </Table.Td>
      <Table.Td fw={700}>{formatCents(amounts.annualCents)}</Table.Td>
      <Table.Td fw={700}>{formatPortion(portion)}</Table.Td>
    </Table.Tr>
  )
}

/**
 * Presentational Summary reconciliation, mirroring the household's spreadsheet:
 * Available, each group's fortnightly/annual/portion, and the running After
 * Outgoing and After Saving (remaining buffer) figures. A compact ledger of
 * rows shows on narrow screens; a table appears at wider breakpoints.
 */
export function SummaryView({ summary }: SummaryViewProps) {
  const wide = useMediaQuery('(min-width: 48em)')

  const groupRow = (key: keyof BudgetSummary['groups'], label: string): GroupRow => ({
    label,
    fortnightlyCents: summary.groups[key].fortnightlyCents,
    annualCents: summary.groups[key].annualCents,
    portion: summary.groups[key].portion,
  })

  const outgoingRows: GroupRow[] = GROUP_ORDER.filter(({ key }) => OUTGOING_KEYS.includes(key)).map(
    ({ key, label }) => groupRow(key, label),
  )
  const savingRows: GroupRow[] = GROUP_ORDER.filter(({ key }) => !OUTGOING_KEYS.includes(key)).map(
    ({ key, label }) => groupRow(key, label),
  )

  const hasData =
    summary.available.annualCents !== 0 ||
    summary.outgoings.annualCents !== 0 ||
    summary.savingsBlock.annualCents !== 0

  return (
    <Stack gap="sm">
      <Title order={2} visibleFrom="sm">
        Summary
      </Title>

      {!hasData ? (
        <Text c="dimmed">
          Nothing to reconcile yet. Add inflows and budget lines to see how your money is allocated.
        </Text>
      ) : (
        <>
          <AllocationDonut summary={summary} />
          {wide ? (
            <Table.ScrollContainer minWidth={0}>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Line</Table.Th>
                    <Table.Th>Fortnightly</Table.Th>
                    <Table.Th>Annual</Table.Th>
                    <Table.Th>Portion</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <RunningRow
                    label="Available"
                    amounts={summary.available}
                    portion={runningPortion(summary.available, summary.available)}
                  />
                  {outgoingRows.map((row) => (
                    <Table.Tr key={row.label}>
                      <Table.Th scope="row">{row.label}</Table.Th>
                      <Table.Td>{formatCents(row.fortnightlyCents)}</Table.Td>
                      <Table.Td>{formatCents(row.annualCents)}</Table.Td>
                      <Table.Td fw={700}>{formatPortion(row.portion)}</Table.Td>
                    </Table.Tr>
                  ))}
                  <RunningRow
                    label="After Outgoing"
                    amounts={summary.afterOutgoing}
                    portion={runningPortion(summary.afterOutgoing, summary.available)}
                  />
                  {savingRows.map((row) => (
                    <Table.Tr key={row.label}>
                      <Table.Th scope="row">{row.label}</Table.Th>
                      <Table.Td>{formatCents(row.fortnightlyCents)}</Table.Td>
                      <Table.Td>{formatCents(row.annualCents)}</Table.Td>
                      <Table.Td fw={700}>{formatPortion(row.portion)}</Table.Td>
                    </Table.Tr>
                  ))}
                  <RunningRow
                    label="After Saving"
                    amounts={summary.afterSaving}
                    portion={runningPortion(summary.afterSaving, summary.available)}
                    signed
                  />
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Card withBorder radius="md" p="xs">
              <Stack gap={2}>
                <ReconRow
                  label="Available"
                  amounts={summary.available}
                  portion={runningPortion(summary.available, summary.available)}
                  running
                />
                {outgoingRows.map((row) => (
                  <ReconRow key={row.label} label={row.label} amounts={row} portion={row.portion} />
                ))}
                <ReconRow
                  label="After Outgoing"
                  amounts={summary.afterOutgoing}
                  portion={runningPortion(summary.afterOutgoing, summary.available)}
                  running
                />
                {savingRows.map((row) => (
                  <ReconRow key={row.label} label={row.label} amounts={row} portion={row.portion} />
                ))}
                <ReconRow
                  label="After Saving"
                  amounts={summary.afterSaving}
                  portion={runningPortion(summary.afterSaving, summary.available)}
                  running
                  signed
                />
              </Stack>
            </Card>
          )}
        </>
      )}
    </Stack>
  )
}
