import { CompositeChart } from '@mantine/charts'
import {
  Card,
  ColorSwatch,
  Divider,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { NetWorthProjectionPoint } from '@nest/plan'
import { formatCents, formatCompactDollars } from '../lib/money'
import {
  NET_WORTH_SERIES_COLORS,
  projectionTooltipItems,
  type NetWorthProjectionRow,
} from '../lib/netWorthChart'
import {
  readProjectionOpen,
  writeProjectionOpen,
  type ProjectionHorizonOption,
} from '../lib/retirement'
import { EmptyState } from './EmptyState'

/** The horizon options offered by the control, in order. */
const HORIZON_OPTIONS: { value: ProjectionHorizonOption; label: string }[] = [
  { value: '5y', label: '5y' },
  { value: '10y', label: '10y' },
  { value: '20y', label: '20y' },
  { value: '30y', label: '30y' },
  { value: 'retirement', label: 'To retirement' },
]

/** The props recharts passes to a tooltip content component. */
interface ProjectionTooltipProps {
  active?: boolean
  payload?: readonly { payload?: NetWorthProjectionRow }[]
}

/**
 * The chart's hover tooltip: every asset as a positive line item and every
 * liability (HELP debt, debt accounts) as a negative one — so the liabilities that
 * are not plotted are still itemised — then the net-worth total.
 */
export function ProjectionTooltip({ active, payload }: ProjectionTooltipProps) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) {
    return null
  }
  return (
    <Paper
      withBorder
      shadow="md"
      radius="md"
      p="sm"
      role="dialog"
      aria-label="Projection breakdown"
    >
      <Stack gap="xxs">
        <Text fw={600} fz="sm">
          {row.year}
        </Text>
        {projectionTooltipItems(row).map((item) => (
          <Group key={item.label} justify="space-between" gap="lg" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <ColorSwatch color={item.color} size={10} withShadow={false} />
              <Text fz="xs">{item.label}</Text>
            </Group>
            <Text fz="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatCents(item.cents)}
            </Text>
          </Group>
        ))}
        <Divider my={2} />
        <Group justify="space-between" gap="lg" wrap="nowrap">
          <Text fw={600} fz="xs">
            Net worth
          </Text>
          <Text fw={600} fz="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatCents(row.total)}
          </Text>
        </Group>
      </Stack>
    </Paper>
  )
}

interface NetWorthProjectionChartProps {
  points: NetWorthProjectionPoint[]
  /** Calendar year of the first point (year 0), for the x-axis labels. */
  baseYear: number
  /** The selected horizon and a callback to change it; both drive the horizon control. */
  horizon?: ProjectionHorizonOption
  onHorizonChange?: (horizon: ProjectionHorizonOption) => void
}

/**
 * The net worth projected forward: the asset components (super, cash and other
 * accounts, and — when any grant vests within the horizon — equity) as stacked
 * areas, with net worth (assets less liabilities) overlaid as a line. Liabilities
 * are not plotted as their own areas; they stay in the net-worth total and are
 * itemised in the hover tooltip. Falls back to an empty state when the household
 * has nothing to project.
 */
export function NetWorthProjectionChart({
  points,
  baseYear,
  horizon,
  onHorizonChange,
}: NetWorthProjectionChartProps) {
  const [opened, { toggle }] = useDisclosure(readProjectionOpen(), {
    onOpen: () => writeProjectionOpen(true),
    onClose: () => writeProjectionOpen(false),
  })
  const hasData = points.some(
    (point) =>
      point.superCents > 0 ||
      point.otherCents > 0 ||
      point.equityCents > 0 ||
      point.helpCents > 0 ||
      point.debtCents > 0,
  )
  const showEquity = points.some((point) => point.equityCents > 0)

  const data: NetWorthProjectionRow[] = points.map((point) => ({
    year: String(baseYear + point.year),
    super: point.superCents,
    cash: point.otherCents,
    equity: point.equityCents,
    // Liabilities are carried for the tooltip but not plotted as series.
    help: point.helpCents,
    debt: point.debtCents,
    total: point.totalCents,
  }))

  const series: CompositeChart.Series[] = [
    { name: 'super', label: 'Super', color: NET_WORTH_SERIES_COLORS.super, type: 'area' },
    { name: 'cash', label: 'Cash & other', color: NET_WORTH_SERIES_COLORS.cash, type: 'area' },
    ...(showEquity
      ? [
          {
            name: 'equity',
            label: 'Equity',
            color: NET_WORTH_SERIES_COLORS.equity,
            type: 'area' as const,
          },
        ]
      : []),
    { name: 'total', label: 'Net worth', color: NET_WORTH_SERIES_COLORS.total, type: 'line' },
  ]

  return (
    <Card component="section" aria-label="Net worth projection" withBorder radius="md" p="md">
      <Stack gap="sm">
        <UnstyledButton
          onClick={toggle}
          aria-expanded={opened}
          aria-controls="net-worth-projection-body"
          w="100%"
        >
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            {opened ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
            <Title order={3} size="h5">
              Projected forward
            </Title>
          </Group>
        </UnstyledButton>
        {opened && (
          <Stack gap="sm" id="net-worth-projection-body">
            {horizon && onHorizonChange && (
              <SegmentedControl
                size="xs"
                fullWidth
                aria-label="Projection horizon"
                value={horizon}
                onChange={(value) => onHorizonChange(value as ProjectionHorizonOption)}
                data={HORIZON_OPTIONS}
              />
            )}
            {hasData ? (
              <>
                <CompositeChart
                  h={260}
                  data={data}
                  dataKey="year"
                  series={series}
                  curveType="monotone"
                  withDots={false}
                  withLegend
                  valueFormatter={formatCompactDollars}
                  yAxisProps={{ width: 48 }}
                  areaProps={{ stackId: 'assets', fillOpacity: 0.25 }}
                  tooltipProps={{ content: ProjectionTooltip }}
                />
                <Text size="xs" c="dimmed">
                  Estimated future (nominal) dollars from your retirement assumptions. The areas are
                  your assets and the line is net worth — assets less your liabilities (HELP debt
                  and debt accounts), which are itemised in the tooltip. Super compounds and accrues
                  contributions, cash grows by ongoing savings-goal contributions, equity grows as
                  it vests at today&rsquo;s price, HELP debt follows its projected paydown, and
                  debt-account balances are held flat.
                </Text>
              </>
            ) : (
              <EmptyState>
                Add super, account balances, or equity to project your net worth forward.
              </EmptyState>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}
