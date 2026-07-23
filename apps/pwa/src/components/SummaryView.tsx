import { DonutChart } from '@mantine/charts'
import {
  Card,
  ColorSwatch,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useLocalStorage, useMediaQuery } from '@mantine/hooks'
import type { Amounts, BudgetSummary } from '@nest/plan'
import { formatCents } from '../lib/money'
import { chartColors } from '../lib/tokens'
import { EmptyState } from './EmptyState'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

/**
 * The basis the allocation donut divides against: take-home (post-tax) available
 * cash, or gross (pre-tax) income with the tax and salary-sacrifice slices
 * prepended.
 */
type IncomeBasis = 'take-home' | 'gross'

/** localStorage key persisting the allocation donut's income basis. */
const INCOME_BASIS_STORAGE_KEY = 'summary-income-basis'

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

/**
 * A slice's share of the mode's fortnightly basis (0 when the basis is 0), so
 * the ledger and donut agree on every percentage.
 */
function portionAgainst(fortnightlyCents: number, basisFortnightly: number): number {
  return basisFortnightly === 0 ? 0 : fortnightlyCents / basisFortnightly
}

/** One reconciliation ledger line: its label, amounts, and rendering flags. */
interface LedgerRow {
  label: string
  amounts: Amounts
  /** A running subtotal (Gross / Available / After Outgoing / After Saving): tinted and bold. */
  running: boolean
  /** Whether the amount takes the money-sign colour. */
  signed?: boolean
}

/**
 * The six budget groups in reconciliation order, each with its human label. The
 * allocation-segment colour each takes in the donut comes from the shared
 * `chartColors` token palette (`chartColors[key]`), so the palette lives in one
 * place across the app.
 */
const GROUP_ORDER: { key: keyof BudgetSummary['groups']; label: string }[] = [
  { key: 'needs', label: 'Needs' },
  { key: 'wants', label: 'Wants' },
  { key: 'discretionary', label: 'Discretionary' },
  { key: 'temporary', label: 'Temporary' },
  { key: 'savings', label: 'Savings' },
  { key: 'investments', label: 'Investments' },
]

/** The keys of the groups that make up outgoings, in reconciliation order. */
const OUTGOING_KEYS: (keyof BudgetSummary['groups'])[] = [
  'needs',
  'wants',
  'discretionary',
  'temporary',
]

/** A donut segment: an allocation slice with its label, amount, colour, and share. */
interface Segment {
  name: string
  value: number
  color: string
  portion: number
}

/**
 * The gross income basis: take-home available cash plus the tax and salary-
 * sacrifice slices that precede it.
 */
function grossAmounts(summary: BudgetSummary): Amounts {
  return {
    fortnightlyCents:
      summary.available.fortnightlyCents +
      summary.tax.fortnightlyCents +
      summary.salarySacrifice.fortnightlyCents,
    annualCents:
      summary.available.annualCents + summary.tax.annualCents + summary.salarySacrifice.annualCents,
  }
}

/** The gross income basis in fortnightly cents. */
function grossBasisCents(summary: BudgetSummary): number {
  return grossAmounts(summary).fortnightlyCents
}

/** The fortnightly basis a mode's donut divides its slices against. */
function basisCents(summary: BudgetSummary, mode: IncomeBasis): number {
  return mode === 'gross' ? grossBasisCents(summary) : summary.available.fortnightlyCents
}

/**
 * The allocation segments for the donut, as shares of the mode's basis. In both
 * modes: each non-empty group by its fortnightly amount, then a Buffer slice for
 * a positive After Saving remainder. In `gross` mode a Tax slice and a
 * salary-sacrifice slice are prepended (each when positive), so the donut sums
 * to gross income. Empty slices and a non-positive buffer are omitted.
 */
function allocationSegments(summary: BudgetSummary, mode: IncomeBasis): Segment[] {
  const basis = basisCents(summary, mode)
  const portionOf = (value: number): number => (basis === 0 ? 0 : value / basis)
  const add = (segments: Segment[], name: string, value: number, color: string): void => {
    if (value > 0) {
      segments.push({ name, value, color, portion: portionOf(value) })
    }
  }

  const segments: Segment[] = []
  if (mode === 'gross') {
    add(segments, 'Tax', summary.tax.fortnightlyCents, chartColors.tax)
    add(
      segments,
      'Salary sacrifice',
      summary.salarySacrifice.fortnightlyCents,
      chartColors.sacrifice,
    )
  }
  for (const { key, label } of GROUP_ORDER) {
    add(segments, label, summary.groups[key].fortnightlyCents, chartColors[key])
  }
  add(segments, 'Buffer', summary.afterSaving.fortnightlyCents, chartColors.buffer)
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
      <MoneyText cents={cents} colored={signed} fw={700} />
    </Stack>
  )
}

/**
 * The stat tiles beneath the donut. Both modes show income, outgoing, and the
 * remaining buffer; gross prepends the gross basis, tax, and salary sacrifice,
 * so gross renders six tiles across two rows.
 */
function DonutTiles({ summary, mode }: { summary: BudgetSummary; mode: IncomeBasis }) {
  return (
    <>
      {mode === 'gross' && (
        <>
          <TotalTile label="Gross" cents={grossBasisCents(summary)} />
          <TotalTile label="Tax" cents={summary.tax.fortnightlyCents} />
          <TotalTile label="Salary sacrifice" cents={summary.salarySacrifice.fortnightlyCents} />
        </>
      )}
      <TotalTile label="Income" cents={summary.available.fortnightlyCents} />
      <TotalTile label="Outgoing" cents={summary.outgoings.fortnightlyCents} />
      <TotalTile label="Remaining" cents={summary.afterSaving.fortnightlyCents} signed />
    </>
  )
}

/**
 * A donut of how fortnightly cash splits across the groups, viewable on a
 * take-home (post-tax) or gross (pre-tax) basis via a toggle. The leftover
 * buffer shows in the centre, a row of totals below, and a legend of each
 * slice's share of the basis.
 */
function AllocationDonut({
  summary,
  mode,
  setMode,
}: {
  summary: BudgetSummary
  mode: IncomeBasis
  setMode: (value: IncomeBasis) => void
}) {
  const segments = allocationSegments(summary, mode)
  if (segments.length === 0) {
    return null
  }

  return (
    <Card component="section" aria-label="Allocation" withBorder radius="md" p="md">
      <Stack gap="md" align="center">
        <Group justify="space-between" wrap="nowrap" w="100%">
          <Title order={3} size="h5">
            Fortnightly allocation
          </Title>
          <SegmentedControl
            size="xs"
            aria-label="Income basis"
            value={mode}
            onChange={(value) => setMode(value as IncomeBasis)}
            data={[
              { value: 'take-home', label: 'Take-home' },
              { value: 'gross', label: 'Gross' },
            ]}
          />
        </Group>
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
          <DonutTiles summary={summary} mode={mode} />
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
        <MoneyText
          cents={amounts.fortnightlyCents}
          colored={signed}
          fw={700}
          size="sm"
          w={92}
          ta="right"
        />
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
      <Table.Td fw={700}>
        <MoneyText span cents={amounts.fortnightlyCents} colored={signed} />
      </Table.Td>
      <Table.Td fw={700}>
        <MoneyText span cents={amounts.annualCents} />
      </Table.Td>
      <Table.Td fw={700}>{formatPortion(portion)}</Table.Td>
    </Table.Tr>
  )
}

/** A non-running group's row in the wide-screen table. */
function GroupTableRow({ row, portion }: { row: LedgerRow; portion: number }) {
  return (
    <Table.Tr>
      <Table.Th scope="row">{row.label}</Table.Th>
      <Table.Td>
        <MoneyText span cents={row.amounts.fortnightlyCents} />
      </Table.Td>
      <Table.Td>
        <MoneyText span cents={row.amounts.annualCents} />
      </Table.Td>
      <Table.Td fw={700}>{formatPortion(portion)}</Table.Td>
    </Table.Tr>
  )
}

/**
 * The reconciliation ledger rows in order: on the gross basis, a Gross running
 * subtotal then Tax and salary-sacrifice deductions precede Available; then
 * Available, the outgoing groups, After Outgoing, the saving groups, and After
 * Saving.
 */
function ledgerRows(summary: BudgetSummary, mode: IncomeBasis): LedgerRow[] {
  const groupRows = (keys: (keyof BudgetSummary['groups'])[]): LedgerRow[] =>
    GROUP_ORDER.filter(({ key }) => keys.includes(key)).map(({ key, label }) => ({
      label,
      amounts: summary.groups[key],
      running: false,
    }))
  const savingKeys = GROUP_ORDER.map(({ key }) => key).filter((key) => !OUTGOING_KEYS.includes(key))

  return [
    ...(mode === 'gross'
      ? [
          { label: 'Gross', amounts: grossAmounts(summary), running: true },
          { label: 'Tax', amounts: summary.tax, running: false },
          { label: 'Salary sacrifice', amounts: summary.salarySacrifice, running: false },
        ]
      : []),
    { label: 'Available', amounts: summary.available, running: true },
    ...groupRows(OUTGOING_KEYS),
    { label: 'After Outgoing', amounts: summary.afterOutgoing, running: true },
    ...groupRows(savingKeys),
    { label: 'After Saving', amounts: summary.afterSaving, running: true, signed: true },
  ]
}

/**
 * Presentational Summary reconciliation, mirroring the household's spreadsheet:
 * Available, each group's fortnightly/annual/portion, and the running After
 * Outgoing and After Saving (remaining buffer) figures. On the gross basis a
 * Gross subtotal and the Tax and salary-sacrifice deductions lead the ledger. A compact
 * ledger of rows shows on narrow screens; a table appears at wider breakpoints.
 */
export function SummaryView({ summary }: SummaryViewProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  const [mode, setMode] = useLocalStorage<IncomeBasis>({
    key: INCOME_BASIS_STORAGE_KEY,
    defaultValue: 'take-home',
    getInitialValueInEffect: false,
  })

  const basisFortnightly = basisCents(summary, mode)
  const portionOf = (amounts: Amounts): number =>
    portionAgainst(amounts.fortnightlyCents, basisFortnightly)
  const rows = ledgerRows(summary, mode)

  const hasData =
    summary.available.annualCents !== 0 ||
    summary.outgoings.annualCents !== 0 ||
    summary.savingsBlock.annualCents !== 0

  return (
    <PageSection title="Summary">
      {!hasData ? (
        <EmptyState>
          Nothing to reconcile yet. Add inflows and budget items to see how your money is allocated.
        </EmptyState>
      ) : (
        <>
          <AllocationDonut summary={summary} mode={mode} setMode={setMode} />
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
                  {rows.map((row) =>
                    row.running ? (
                      <RunningRow
                        key={row.label}
                        label={row.label}
                        amounts={row.amounts}
                        portion={portionOf(row.amounts)}
                        signed={row.signed}
                      />
                    ) : (
                      <GroupTableRow key={row.label} row={row} portion={portionOf(row.amounts)} />
                    ),
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Card withBorder radius="md" p="xs">
              <Stack gap={2}>
                {rows.map((row) => (
                  <ReconRow
                    key={row.label}
                    label={row.label}
                    amounts={row.amounts}
                    portion={portionOf(row.amounts)}
                    running={row.running}
                    signed={row.signed}
                  />
                ))}
              </Stack>
            </Card>
          )}
        </>
      )}
    </PageSection>
  )
}
