/* eslint-disable react/only-export-components -- the split-row disclosure primitives and their hook are one unit. */
import type { ReactNode } from 'react'
import { Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { AssignmentLine } from '@nest/plan'
import { formatPerFortnight } from '../lib/money'

/**
 * A pay-split row's expand-to-breakdown disclosure: a leading-chevron
 * `UnstyledButton` header wrapping the account's identity, over a `Collapse`
 * holding the budget lines behind the account's total.
 */
export function useSplitBreakdown(accountId: string) {
  const [expanded, { toggle }] = useDisclosure(false)
  return { expanded, toggle, bodyId: `split-lines-${accountId}` }
}

/**
 * The clickable header of a split row's breakdown: a chevron and the account's
 * identity (`children`), taking the row's remaining width beside the amount and
 * any trailing controls.
 */
export function BreakdownToggle({
  expanded,
  onToggle,
  bodyId,
  children,
}: {
  expanded: boolean
  onToggle: () => void
  bodyId: string
  children: ReactNode
}) {
  const Chevron = expanded ? IconChevronDown : IconChevronRight
  return (
    <UnstyledButton
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={bodyId}
      style={{ flex: 1, minWidth: 0 }}
    >
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Chevron size={14} style={{ flexShrink: 0 }} />
        {children}
      </Group>
    </UnstyledButton>
  )
}

/**
 * The budget lines behind an account's split, each with its own fortnightly
 * figure. The lines sum to the account's exact (pre-rounding) total; where
 * rounding lifts the row's headline to the next $5, the exact-figure note beside
 * the headline bridges the two.
 */
export function BreakdownLines({ lines }: { lines: readonly AssignmentLine[] }) {
  return (
    <Stack gap={2} pt={6} pl="lg">
      {lines.map((line) => (
        <Group key={line.id} justify="space-between" wrap="nowrap" gap="sm">
          <Text size="xs" c="dimmed" truncate>
            {line.name}
          </Text>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {formatPerFortnight(line.fortnightlyCents)}
          </Text>
        </Group>
      ))}
    </Stack>
  )
}

/** The `Collapse` body wrapping {@link BreakdownLines}, shared by every split row variant. */
export function BreakdownPanel({
  expanded,
  bodyId,
  lines,
}: {
  expanded: boolean
  bodyId: string
  lines: readonly AssignmentLine[]
}) {
  return (
    <Collapse expanded={expanded} id={bodyId}>
      <BreakdownLines lines={lines} />
    </Collapse>
  )
}
