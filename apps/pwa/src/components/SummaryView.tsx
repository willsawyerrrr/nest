import { Card, ColorSwatch, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { DonutChart } from '@mantine/charts'
import { useMediaQuery } from '@mantine/hooks'
import type { Amounts, BudgetSummary } from '@budget/plan'
import { formatCents } from '../lib/money'

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

/** A group's totals plus its portion of available cash. */
interface GroupRow {
  label: string
  fortnightlyCents: number
  annualCents: number
  portion: number
}

/**
 * The six budget groups in reconciliation order, each with its human label and
 * the CSS colour its allocation segment takes in the donut.
 */
const GROUP_ORDER: { key: keyof BudgetSummary['groups']; label: string; color: string }[] = [
  { key: 'needs', label: 'Needs', color: 'var(--mantine-color-indigo-6)' },
  { key: 'wants', label: 'Wants', color: 'var(--mantine-color-blue-5)' },
  { key: 'discretionary', label: 'Discretionary', color: 'var(--mantine-color-cyan-5)' },
  { key: 'temporary', label: 'Temporary', color: 'var(--mantine-color-grape-5)' },
  { key: 'savings', label: 'Savings', color: 'var(--mantine-color-teal-5)' },
  { key: 'investments', label: 'Investments', color: 'var(--mantine-color-green-5)' },
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

/** A compact stat tile: a dimmed label above its bold fortnightly value. */
function TotalTile({ label, cents }: { label: string; cents: number }) {
  return (
    <Stack gap={0} align="center">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700}>{formatCents(cents)}</Text>
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
        <Title order={4} style={{ alignSelf: 'flex-start' }}>
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
          <TotalTile label="Remaining" cents={summary.afterSaving.fortnightlyCents} />
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

/** A running reconciliation figure (Available / After Outgoing / After Saving). */
function RunningCard({ label, amounts }: { label: string; amounts: Amounts }) {
  return (
    <Card
      component="section"
      aria-label={label}
      withBorder
      radius="md"
      p="md"
      bg="var(--mantine-primary-color-light)"
    >
      <Stack gap="xs">
        <Title order={4}>{label}</Title>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Fortnightly
          </Text>
          <Text fw={700}>{formatCents(amounts.fortnightlyCents)}</Text>
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Annual
          </Text>
          <Text fw={700}>{formatCents(amounts.annualCents)}</Text>
        </Group>
      </Stack>
    </Card>
  )
}

/** A single budget group's fortnightly, annual, and portion figures. */
function GroupCard({ row }: { row: GroupRow }) {
  return (
    <Card component="section" aria-label={row.label} withBorder radius="md" p="md">
      <Stack gap="xs">
        <Title order={5}>{row.label}</Title>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Fortnightly
          </Text>
          <Text fw={600}>{formatCents(row.fortnightlyCents)}</Text>
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Annual
          </Text>
          <Text fw={600}>{formatCents(row.annualCents)}</Text>
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Portion
          </Text>
          <Text fw={600}>{formatPortion(row.portion)}</Text>
        </Group>
      </Stack>
    </Card>
  )
}

/** One running figure's row in the wide-screen table (no portion). */
function RunningRow({ label, amounts }: { label: string; amounts: Amounts }) {
  return (
    <Table.Tr bg="var(--mantine-primary-color-light)">
      <Table.Th scope="row">{label}</Table.Th>
      <Table.Td fw={700}>{formatCents(amounts.fortnightlyCents)}</Table.Td>
      <Table.Td fw={700}>{formatCents(amounts.annualCents)}</Table.Td>
      <Table.Td c="dimmed">—</Table.Td>
    </Table.Tr>
  )
}

/**
 * Presentational Summary reconciliation, mirroring the household's spreadsheet:
 * Available, each group's fortnightly/annual/portion, and the running After
 * Outgoing and After Saving (remaining buffer) figures. Cards stack on narrow
 * screens; a table appears at wider breakpoints.
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
    <Stack gap="md">
      <Title order={2}>Summary</Title>

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
                  <RunningRow label="Available" amounts={summary.available} />
                  {outgoingRows.map((row) => (
                    <Table.Tr key={row.label}>
                      <Table.Th scope="row">{row.label}</Table.Th>
                      <Table.Td>{formatCents(row.fortnightlyCents)}</Table.Td>
                      <Table.Td>{formatCents(row.annualCents)}</Table.Td>
                      <Table.Td>{formatPortion(row.portion)}</Table.Td>
                    </Table.Tr>
                  ))}
                  <RunningRow label="After Outgoing" amounts={summary.afterOutgoing} />
                  {savingRows.map((row) => (
                    <Table.Tr key={row.label}>
                      <Table.Th scope="row">{row.label}</Table.Th>
                      <Table.Td>{formatCents(row.fortnightlyCents)}</Table.Td>
                      <Table.Td>{formatCents(row.annualCents)}</Table.Td>
                      <Table.Td>{formatPortion(row.portion)}</Table.Td>
                    </Table.Tr>
                  ))}
                  <RunningRow label="After Saving" amounts={summary.afterSaving} />
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Stack gap="md">
              <RunningCard label="Available" amounts={summary.available} />
              {outgoingRows.map((row) => (
                <GroupCard key={row.label} row={row} />
              ))}
              <RunningCard label="After Outgoing" amounts={summary.afterOutgoing} />
              {savingRows.map((row) => (
                <GroupCard key={row.label} row={row} />
              ))}
              <RunningCard label="After Saving" amounts={summary.afterSaving} />
            </Stack>
          )}
        </>
      )}
    </Stack>
  )
}
