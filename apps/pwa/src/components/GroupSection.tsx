import type { ReactNode } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import { formatPerFortnight } from '../lib/money'

interface GroupSectionProps {
  title: string
  subtotalCents: number
  children: ReactNode
}

/** A titled budget section with its fortnightly subtotal and stacked contents. */
export function GroupSection({ title, subtotalCents, children }: GroupSectionProps) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="baseline" wrap="nowrap">
        <Title order={3} size="h5">
          {title}
        </Title>
        <Text fw={700} aria-label={`${title} fortnightly subtotal`}>
          {formatPerFortnight(subtotalCents)}
        </Text>
      </Group>
      {children}
    </Stack>
  )
}
