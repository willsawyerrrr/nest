import { Select } from '@mantine/core'
import type { SankeyOrder } from '../lib/sankeyLayout'

const ORDER_OPTIONS: { value: SankeyOrder; label: string }[] = [
  { value: 'input', label: 'Default order' },
  { value: 'largest', label: 'Largest first' },
  { value: 'smallest', label: 'Smallest first' },
]

/** The dropdown choosing how the cash-flow chart orders budget lines within each category. */
export function SankeyOrderSelect({
  value,
  onChange,
}: {
  value: SankeyOrder
  onChange: (order: SankeyOrder) => void
}) {
  return (
    <Select
      size="xs"
      label="Order budget lines"
      allowDeselect={false}
      data={ORDER_OPTIONS}
      value={value}
      onChange={(next) => next && onChange(next as SankeyOrder)}
    />
  )
}
