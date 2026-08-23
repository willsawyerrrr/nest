import { ActionIcon, Badge, Group, Progress, Stack, Text } from '@mantine/core'
import { IconGift, IconPencil, IconTrash } from '@tabler/icons-react'
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

/**
 * A budgeted / spent / remaining readout with a spend progress bar.
 *
 * When `budgetOnly` is set, only the budgeted amount shows — spend, remaining,
 * and the progress bar are hidden, so a gift for the signed-in member does not
 * spoil the surprise.
 */
export function GiftMoneyBar({
  totals,
  label,
  budgetOnly = false,
}: {
  totals: GiftTotals
  label: string
  budgetOnly?: boolean
}) {
  if (budgetOnly) {
    return (
      <Text size="xs" c="dimmed">
        Budget {formatCents(totals.budgetedCents)}
      </Text>
    )
  }
  const { percent, color } = progress(totals)
  const remainingColor = moneyColor(totals.remainingCents)
  return (
    <Stack gap="xxs">
      <Group gap="md" wrap="wrap">
        <Text size="xs" c="dimmed">
          Budget {formatCents(totals.budgetedCents)}
        </Text>
        <Text size="xs" c="dimmed">
          Spent {formatCents(totals.spentCents)}
        </Text>
        <Text size="xs" fw={600} {...(remainingColor !== undefined && { c: remainingColor })}>
          Left {formatCents(totals.remainingCents)}
        </Text>
      </Group>
      <Progress value={percent} color={color} size="sm" aria-label={`${label} spend`} />
    </Stack>
  )
}

/**
 * One purchase line with edit/delete controls. A purchase linked from a synced
 * Up transaction is marked, so a card purchase reads apart from a typed one. An
 * ad hoc purchase optionally tagged with a recipient shows that tag as a badge —
 * record-keeping only, so it reads apart from the transaction-linked badge. An
 * ad hoc purchase also offers an Assign action, moving it out of the buffer and
 * into a specific recipient's gift budget once one is known.
 */
export function PurchaseRow({
  purchase,
  recipientLabel,
  onAssign,
  onEdit,
  onDelete,
}: {
  purchase: GiftPurchase
  /** The tagged recipient's name, for an ad hoc purchase that names one. */
  recipientLabel?: string | undefined
  /** Assigns this ad hoc purchase to a recipient's gift budget; omitted for a budget-linked purchase, or when there is nothing yet to assign it to. */
  onAssign?: (() => void) | undefined
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Group gap="xxs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" truncate>
            {purchase.description || 'Purchase'}
          </Text>
          {purchase.transaction_id !== null && (
            <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
              From Up
            </Badge>
          )}
          {recipientLabel !== undefined && (
            <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
              For {recipientLabel}
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {formatIsoDate(purchase.purchased_on)}
        </Text>
      </Stack>
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text size="sm" fw={600}>
          {formatCents(purchase.amount_cents)}
        </Text>
        {onAssign && (
          <ActionIcon
            variant="subtle"
            aria-label={`Assign ${purchase.description || 'purchase'}`}
            onClick={onAssign}
          >
            <IconGift size={16} />
          </ActionIcon>
        )}
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
