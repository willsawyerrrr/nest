import { ActionIcon, Button, Group, Paper, Stack, Switch, Text } from '@mantine/core'
import type { PayPeriod } from '@nest/plan'
import { formatIsoDate } from '../lib/dates'
import { formatCents } from '../lib/money'

interface ActualSpendBarProps {
  /** The fortnight whose spend each group shows. */
  period: PayPeriod
  /** Whether `period` is the fortnight holding today, past which there is nothing to step to. */
  isCurrent: boolean
  onPrevious: () => void
  onNext: () => void
  includePending: boolean
  onIncludePendingChange: (includePending: boolean) => void
  /** Spend in no group this fortnight; null while loading. */
  unbudgetedCents: number | null
  /** Opens the Up category → budget group map. */
  onEditCategoryGroups: () => void
}

/**
 * The Budget tab's actual-spend controls: the reconciled fortnight with
 * steppers to earlier ones, whether pending spend counts, the spend that
 * counts toward no group, and a way into the category → group map.
 */
export function ActualSpendBar({
  period,
  isCurrent,
  onPrevious,
  onNext,
  includePending,
  onIncludePendingChange,
  unbudgetedCents,
  onEditCategoryGroups,
}: ActualSpendBarProps) {
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <ActionIcon variant="default" aria-label="Previous fortnight" onClick={onPrevious}>
            ‹
          </ActionIcon>
          <Stack gap={0} align="center">
            <Text size="xs" c="dimmed">
              {isCurrent ? 'Spent this fortnight' : 'Spent that fortnight'}
            </Text>
            <Text fw={600} aria-label="Reconciled fortnight">
              {formatIsoDate(period.periodStart)} – {formatIsoDate(period.periodEnd)}
            </Text>
          </Stack>
          <ActionIcon
            variant="default"
            aria-label="Next fortnight"
            onClick={onNext}
            disabled={isCurrent}
          >
            ›
          </ActionIcon>
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Switch
            size="sm"
            label="Include pending"
            checked={includePending}
            onChange={(event) => onIncludePendingChange(event.currentTarget.checked)}
          />
          {unbudgetedCents !== null && unbudgetedCents !== 0 && (
            <Text size="sm" c="dimmed" aria-label="Spend in no group">
              {formatCents(unbudgetedCents)} in no group
            </Text>
          )}
        </Group>
        <Button variant="subtle" size="xs" onClick={onEditCategoryGroups}>
          Category groups
        </Button>
      </Stack>
    </Paper>
  )
}
