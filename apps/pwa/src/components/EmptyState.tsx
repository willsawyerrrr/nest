import type { ReactNode } from 'react'
import { Text } from '@mantine/core'

interface EmptyStateProps {
  /** The "nothing here yet" message to show in place of a list's items. */
  children: ReactNode
}

/** The standard empty-state message shown when a list has no items. */
export function EmptyState({ children }: EmptyStateProps) {
  return (
    <Text c="dimmed" size="sm">
      {children}
    </Text>
  )
}
