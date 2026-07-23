import type { ReactNode } from 'react'
import { Stack, Text, Title, type MantineSpacing, type StackProps } from '@mantine/core'

interface PageSectionProps extends Omit<StackProps, 'title'> {
  /** The page title, rendered identically on mobile and desktop. */
  title: string
  /** Optional intro copy shown beneath the title. */
  intro?: ReactNode
  /** The gap between the title block and the page body. */
  gap?: MantineSpacing
  children: ReactNode
}

/**
 * The page scaffold: a consistent root `Stack`, a unified page title, and
 * optional intro text above the page body. Screens wrap their content in this so
 * every tab shares the same heading treatment and vertical rhythm.
 */
export function PageSection({
  title,
  intro,
  gap = 'md',
  children,
  ...stackProps
}: PageSectionProps) {
  return (
    <Stack gap={gap} {...stackProps}>
      <Stack gap="xxs">
        <Title order={2}>{title}</Title>
        {intro != null && (
          <Text c="dimmed" size="sm">
            {intro}
          </Text>
        )}
      </Stack>
      {children}
    </Stack>
  )
}
