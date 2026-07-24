import { DonutChart } from '@mantine/charts'
import { formatCents } from '../lib/money'

/** One donut segment: its label, fortnightly amount, and swatch colour. */
export interface AllocationDonutSegment {
  name: string
  value: number
  color: string
}

interface AllocationDonutChartProps {
  segments: AllocationDonutSegment[]
  /** The centred label, the leftover buffer as formatted cents. */
  chartLabel: string
}

/**
 * The allocation donut's recharts graphic, isolated behind a lazy boundary so
 * the charting library forms its own chunk and stays out of the initial and
 * default-route bundles.
 */
export default function AllocationDonutChart({ segments, chartLabel }: AllocationDonutChartProps) {
  return (
    <DonutChart
      data={segments}
      size={180}
      thickness={28}
      withTooltip
      tooltipDataSource="segment"
      valueFormatter={formatCents}
      chartLabel={chartLabel}
    />
  )
}
