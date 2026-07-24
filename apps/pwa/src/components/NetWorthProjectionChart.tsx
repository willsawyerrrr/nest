import { CompositeChart } from '@mantine/charts'
import { Card, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import type { NetWorthProjectionPoint } from '@nest/plan'
import { formatCents } from '../lib/money'
import type { ProjectionHorizonOption } from '../lib/retirement'
import { chartColors } from '../lib/tokens'
import { EmptyState } from './EmptyState'

/** The horizon options offered by the control, in order. */
const HORIZON_OPTIONS: { value: ProjectionHorizonOption; label: string }[] = [
  { value: '5y', label: '5y' },
  { value: '10y', label: '10y' },
  { value: '20y', label: '20y' },
  { value: '30y', label: '30y' },
  { value: 'retirement', label: 'To retirement' },
]

/**
 * Token colours for the projection series, from the shared chart palette. Assets
 * take the cool teal / indigo / violet of the Super, Other-accounts, and Equity
 * groups; liabilities take warm debt tones (the cost-red of the tax family for HELP
 * and orange for debt accounts) so they read apart from the assets; the net-worth
 * line takes the brand lime.
 */
const SERIES_COLORS = {
  super: chartColors.savings,
  cash: chartColors.needs,
  equity: chartColors.wants,
  help: chartColors.tax,
  debt: chartColors.temporary,
  total: chartColors.sacrifice,
} as const

/** The series drawn below the axis as negative-magnitude liability bands. */
const LIABILITY_SERIES = new Set(['help', 'debt'])

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
 * areas above the axis, the liabilities (HELP debt and debt accounts) as their own
 * stacked bands below it, and net worth (assets less liabilities) overlaid as a
 * line crossing through. Each band that carries a value is its own series. Falls
 * back to an empty state when the household has nothing to project.
 */
export function NetWorthProjectionChart({
  points,
  baseYear,
  horizon,
  onHorizonChange,
}: NetWorthProjectionChartProps) {
  const hasData = points.some(
    (point) =>
      point.superCents > 0 ||
      point.otherCents > 0 ||
      point.equityCents > 0 ||
      point.helpCents > 0 ||
      point.debtCents > 0,
  )
  const showEquity = points.some((point) => point.equityCents > 0)
  const showHelp = points.some((point) => point.helpCents > 0)
  const showDebt = points.some((point) => point.debtCents > 0)

  const data = points.map((point) => ({
    year: String(baseYear + point.year),
    super: point.superCents,
    cash: point.otherCents,
    equity: point.equityCents,
    // Liabilities plot below the axis as negative magnitudes.
    help: -point.helpCents,
    debt: -point.debtCents,
    total: point.totalCents,
  }))

  const series: CompositeChart.Series[] = [
    { name: 'super', label: 'Super', color: SERIES_COLORS.super, type: 'area' },
    { name: 'cash', label: 'Cash & other', color: SERIES_COLORS.cash, type: 'area' },
    ...(showEquity
      ? [{ name: 'equity', label: 'Equity', color: SERIES_COLORS.equity, type: 'area' as const }]
      : []),
    ...(showHelp
      ? [{ name: 'help', label: 'HELP debt', color: SERIES_COLORS.help, type: 'area' as const }]
      : []),
    ...(showDebt
      ? [{ name: 'debt', label: 'Debt accounts', color: SERIES_COLORS.debt, type: 'area' as const }]
      : []),
    { name: 'total', label: 'Net worth', color: SERIES_COLORS.total, type: 'line' },
  ]

  return (
    <Card component="section" aria-label="Net worth projection" withBorder radius="md" p="md">
      <Stack gap="sm">
        <Title order={3} size="h5">
          Projected forward
        </Title>
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
              valueFormatter={formatCents}
              areaProps={(item) => ({
                stackId: LIABILITY_SERIES.has(item.name) ? 'liabilities' : 'assets',
                fillOpacity: 0.25,
              })}
            />
            <Text size="xs" c="dimmed">
              Estimated future (nominal) dollars from your retirement assumptions. Assets stack
              above the axis and liabilities below it, with net worth (assets less liabilities) as
              the line. Super compounds and accrues contributions, cash grows by ongoing
              savings-goal contributions, equity grows as it vests at today&rsquo;s price, HELP debt
              follows its projected paydown, and debt-account balances are held flat.
            </Text>
          </>
        ) : (
          <EmptyState>
            Add super, account balances, or equity to project your net worth forward.
          </EmptyState>
        )}
      </Stack>
    </Card>
  )
}
