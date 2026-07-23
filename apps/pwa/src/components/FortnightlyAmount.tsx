import { Group, Text, type GroupProps } from '@mantine/core'
import { MoneyText } from './MoneyText'

interface FortnightlyAmountProps extends GroupProps {
  /** The fortnightly figure, in integer cents. */
  cents: number
}

/**
 * The emphasised fortnightly figure with a dimmed `/ fn` suffix, baseline-aligned.
 * Extra `Group` props (alignment, width) spread onto the wrapper so a caller can
 * place it in a fixed-width, right-aligned column.
 */
export function FortnightlyAmount({ cents, ...groupProps }: FortnightlyAmountProps) {
  return (
    <Group gap={2} wrap="nowrap" align="baseline" {...groupProps}>
      <MoneyText cents={cents} fw={700} size="sm" />
      <Text size="xs" c="dimmed">
        / fn
      </Text>
    </Group>
  )
}
