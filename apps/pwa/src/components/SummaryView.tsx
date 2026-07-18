import { Card, Group, Stack, Table, Text, Title } from '@mantine/core'
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

/** The six budget groups in reconciliation order, each with its human label. */
const GROUP_ORDER: { key: keyof BudgetSummary['groups']; label: string }[] = [
  { key: 'needs', label: 'Needs' },
  { key: 'wants', label: 'Wants' },
  { key: 'discretionary', label: 'Discretionary' },
  { key: 'temporary', label: 'Temporary' },
  { key: 'savings', label: 'Savings' },
  { key: 'investments', label: 'Investments' },
]

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

  const groupRows: GroupRow[] = GROUP_ORDER.map(({ key, label }) => ({
    label,
    fortnightlyCents: summary.groups[key].fortnightlyCents,
    annualCents: summary.groups[key].annualCents,
    portion: summary.groups[key].portion,
  }))

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
      ) : wide ? (
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
              {groupRows.map((row) => (
                <Table.Tr key={row.label}>
                  <Table.Th scope="row">{row.label}</Table.Th>
                  <Table.Td>{formatCents(row.fortnightlyCents)}</Table.Td>
                  <Table.Td>{formatCents(row.annualCents)}</Table.Td>
                  <Table.Td>{formatPortion(row.portion)}</Table.Td>
                </Table.Tr>
              ))}
              <RunningRow label="After Outgoing" amounts={summary.afterOutgoing} />
              <RunningRow label="After Saving" amounts={summary.afterSaving} />
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Stack gap="md">
          <RunningCard label="Available" amounts={summary.available} />
          {groupRows.map((row) => (
            <GroupCard key={row.label} row={row} />
          ))}
          <RunningCard label="After Outgoing" amounts={summary.afterOutgoing} />
          <RunningCard label="After Saving" amounts={summary.afterSaving} />
        </Stack>
      )}
    </Stack>
  )
}
