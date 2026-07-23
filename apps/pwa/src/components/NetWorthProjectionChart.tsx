import { CompositeChart } from '@mantine/charts'
import { Card, Stack, Text, Title } from '@mantine/core'
import type { NetWorthProjectionPoint } from '@nest/plan'
import { formatCents } from '../lib/money'
import { chartColors } from '../lib/tokens'
import { EmptyState } from './EmptyState'

/**
 * Token colours for the projection series, reusing the shared chart palette: the
 * teal, indigo, and violet that the Super, Other-accounts, and Equity groups carry
 * for the stacked assets, and the brand lime for the emphasised net-worth line.
 */
const SERIES_COLORS = {
  super: chartColors.savings,
  cash: chartColors.needs,
  equity: chartColors.wants,
  total: chartColors.sacrifice,
} as const

interface NetWorthProjectionChartProps {
  points: NetWorthProjectionPoint[]
  /** Calendar year of the first point (year 0), for the x-axis labels. */
  baseYear: number
}

/**
 * The net worth projected forward: a stacked area of the asset components (super,
 * cash and other accounts, and — when any grant vests within the horizon — equity)
 * with the resulting net worth (assets less HELP debt) overlaid as a line, so the
 * gap between the stack and the line reads as the shrinking HELP liability. Falls
 * back to an empty state when the household has nothing to project.
 */
export function NetWorthProjectionChart({ points, baseYear }: NetWorthProjectionChartProps) {
  const hasData = points.some(
    (point) =>
      point.superCents > 0 || point.otherCents > 0 || point.equityCents > 0 || point.helpCents > 0,
  )
  const showEquity = points.some((point) => point.equityCents > 0)

  const data = points.map((point) => ({
    year: String(baseYear + point.year),
    super: point.superCents,
    cash: point.otherCents,
    equity: point.equityCents,
    total: point.totalCents,
  }))

  const series: CompositeChart.Series[] = [
    { name: 'super', label: 'Super', color: SERIES_COLORS.super, type: 'area' },
    { name: 'cash', label: 'Cash & other', color: SERIES_COLORS.cash, type: 'area' },
    ...(showEquity
      ? [{ name: 'equity', label: 'Equity', color: SERIES_COLORS.equity, type: 'area' as const }]
      : []),
    { name: 'total', label: 'Net worth', color: SERIES_COLORS.total, type: 'line' },
  ]

  return (
    <Card component="section" aria-label="Net worth projection" withBorder radius="md" p="md">
      <Stack gap="sm">
        <Title order={3} size="h5">
          Projected forward
        </Title>
        {hasData ? (
          <>
            <CompositeChart
              h={240}
              data={data}
              dataKey="year"
              series={series}
              curveType="monotone"
              withDots={false}
              withLegend
              valueFormatter={formatCents}
              areaProps={{ stackId: 'assets', fillOpacity: 0.25 }}
            />
            <Text size="xs" c="dimmed">
              Estimated future (nominal) dollars from your retirement assumptions. Super compounds
              and accrues contributions, cash and account balances are held flat, equity grows as it
              vests at today&rsquo;s price, and HELP debt follows its projected paydown.
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
