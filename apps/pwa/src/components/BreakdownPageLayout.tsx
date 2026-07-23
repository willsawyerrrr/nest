import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Anchor, Group, Stack, Title } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'

interface BreakdownPageLayoutProps {
  /** Where the back link returns to; omit for a top-level page with no back link. */
  backTo?: string
  /** The back link's label, naming its destination. */
  backLabel?: string
  /** The page heading. */
  title: string
  /** Right-aligned header control (e.g. the Edit or Manage toggle). */
  action?: ReactNode
  children: ReactNode
}

/**
 * The shared chrome for a breakdown detail page: an optional back link, a title
 * with an optional right-aligned `action` control, and the page body as
 * `children`.
 */
export function BreakdownPageLayout({
  backTo,
  backLabel,
  title,
  action,
  children,
}: BreakdownPageLayoutProps) {
  return (
    <Stack gap="md">
      {backTo != null && (
        <Anchor component={Link} to={backTo} size="sm">
          <Group gap={4} wrap="nowrap">
            <IconArrowLeft size={16} />
            {backLabel}
          </Group>
        </Anchor>
      )}

      <Group justify="space-between" align="center" wrap="wrap" pt={{ base: 0, sm: 'md' }}>
        <Title order={1} style={{ letterSpacing: '-0.02em' }}>
          {title}
        </Title>
        {action}
      </Group>

      {children}
    </Stack>
  )
}
