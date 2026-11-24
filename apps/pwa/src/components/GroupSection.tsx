import type { ReactNode } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import { formatCents, formatPerFortnight, signMoneyColor } from '../lib/money'

interface GroupSectionProps {
  title: string
  subtotalCents: number
  /** The group's actual spend this fortnight; omitted where nothing is reconciled. */
  actualCents?: number | undefined
  children: ReactNode
}

/**
 * A titled budget section with its fortnightly subtotal and stacked contents.
 * Given `actualCents`, a line beneath the title shows the fortnight's spend
 * against the subtotal and what is left, or by how much it went over.
 */
export function GroupSection({ title, subtotalCents, actualCents, children }: GroupSectionProps) {
  const leftCents = actualCents === undefined ? 0 : subtotalCents - actualCents
  return (
    <Stack gap="xs">
      <Stack gap={2}>
        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Title order={3} size="h5">
            {title}
          </Title>
          <Text fw={700} aria-label={`${title} fortnightly subtotal`}>
            {formatPerFortnight(subtotalCents)}
          </Text>
        </Group>
        {actualCents !== undefined && (
          <Group justify="space-between" align="baseline" wrap="nowrap">
            <Text size="sm" c="dimmed" aria-label={`${title} actual spend`}>
              {formatCents(actualCents)} spent
            </Text>
            <Text
              size="sm"
              c={leftCents === 0 ? 'dimmed' : signMoneyColor(leftCents)}
              aria-label={`${title} left to spend`}
            >
              {leftCents < 0 ? `${formatCents(-leftCents)} over` : `${formatCents(leftCents)} left`}
            </Text>
          </Group>
        )}
      </Stack>
      {children}
    </Stack>
  )
}
