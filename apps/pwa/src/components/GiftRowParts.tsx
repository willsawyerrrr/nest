import { ActionIcon, Group, Progress, Stack, Text } from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import type { GiftPurchase } from '../hooks/useGifts'
import { formatIsoDate } from '../lib/dates'
import type { GiftTotals } from '../lib/gifts'
import { formatCents, moneyColor } from '../lib/money'

/** The spend progress percentage and its bar colour (red once over budget). */
function progress(totals: GiftTotals): { percent: number; color: string } {
  const color = totals.remainingCents < 0 ? 'red' : 'teal'
  if (totals.budgetedCents <= 0) {
    return { percent: totals.spentCents > 0 ? 100 : 0, color }
  }
  return { percent: Math.min(100, (totals.spentCents / totals.budgetedCents) * 100), color }
}

/** A budgeted / spent / remaining readout with a spend progress bar. */
export function GiftMoneyBar({ totals, label }: { totals: GiftTotals; label: string }) {
  const { percent, color } = progress(totals)
  return (
    <Stack gap={4}>
      <Group gap="md" wrap="wrap">
        <Text size="xs" c="dimmed">
          Budget {formatCents(totals.budgetedCents)}
        </Text>
        <Text size="xs" c="dimmed">
          Spent {formatCents(totals.spentCents)}
        </Text>
        <Text size="xs" fw={600} c={moneyColor(totals.remainingCents)}>
          Left {formatCents(totals.remainingCents)}
        </Text>
      </Group>
      <Progress value={percent} color={color} size="sm" aria-label={`${label} spend`} />
    </Stack>
  )
}

/** One purchase line with edit/delete controls. */
export function PurchaseRow({
  purchase,
  onEdit,
  onDelete,
}: {
  purchase: GiftPurchase
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" truncate>
          {purchase.description || 'Purchase'}
        </Text>
        <Text size="xs" c="dimmed">
          {formatIsoDate(purchase.purchased_on)}
        </Text>
      </Stack>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text size="sm" fw={600}>
          {formatCents(purchase.amount_cents)}
        </Text>
        <ActionIcon
          variant="subtle"
          aria-label={`Edit ${purchase.description || 'purchase'}`}
          onClick={onEdit}
        >
          <IconPencil size={16} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="red"
          aria-label={`Delete ${purchase.description || 'purchase'}`}
          onClick={onDelete}
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Group>
    </Group>
  )
}
