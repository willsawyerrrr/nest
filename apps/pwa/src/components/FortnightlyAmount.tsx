import { Group, Text, type GroupProps } from '@mantine/core'
import { ComparedAmount } from './ComparedAmount'

interface FortnightlyAmountProps extends GroupProps {
  /** The fortnightly figure, in integer cents. */
  cents: number
  /**
   * The real figure this one was proposed over. When given and different (and
   * planning mode is on), the amount reads `real → proposed (±Δ)` via
   * {@link ComparedAmount}; otherwise it is the plain figure.
   */
  baselineCents?: number
}

/**
 * The emphasised fortnightly figure with a dimmed `/ fn` suffix, baseline-aligned.
 * Extra `Group` props (alignment, width) spread onto the wrapper so a caller can
 * place it in a fixed-width, right-aligned column.
 */
export function FortnightlyAmount({ cents, baselineCents, ...groupProps }: FortnightlyAmountProps) {
  return (
    <Group gap={2} wrap="nowrap" align="baseline" {...groupProps}>
      <ComparedAmount
        baselineCents={baselineCents ?? cents}
        proposedCents={cents}
        fw={700}
        size="sm"
      />
      <Text size="xs" c="dimmed">
        / fn
      </Text>
    </Group>
  )
}
