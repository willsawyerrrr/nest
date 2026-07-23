import type { ReactNode } from 'react'
import { Group, Stack, Text, type MantineSpacing } from '@mantine/core'

interface ListRowProps {
  /** The row's columns, laid out in a single `nowrap` group. */
  children: ReactNode
  /** Horizontal gap between the columns. */
  gap?: MantineSpacing
  /**
   * A second line beneath the columns. A string is rendered as dimmed caption
   * text; a node is rendered as-is, for richer sub-content.
   */
  caption?: ReactNode
  /** Dulls the whole row (reduced opacity), e.g. for an inactive item. */
  dimmed?: boolean
}

/**
 * One dense, table-like list row: its columns in a `nowrap` group over a light
 * bottom rule, with an optional second line beneath. The desktop counterpart to
 * a compact `AppCard`, shared by the app's long lists so they scan as a table.
 */
export function ListRow({ children, gap = 'md', caption, dimmed }: ListRowProps) {
  return (
    <Stack
      gap={caption == null ? 0 : 4}
      py={6}
      style={{
        borderBottom: '1px solid var(--mantine-color-default-border)',
        opacity: dimmed ? 0.55 : undefined,
      }}
    >
      <Group wrap="nowrap" gap={gap}>
        {children}
      </Group>
      {typeof caption === 'string' ? (
        <Text size="xs" c="dimmed" truncate>
          {caption}
        </Text>
      ) : (
        caption
      )}
    </Stack>
  )
}
