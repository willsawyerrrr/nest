import type { ReactNode } from 'react'
import { ActionIcon, Badge, Group, Progress, Stack, Text } from '@mantine/core'
import { IconGift } from '@tabler/icons-react'
import type { GiftPurchase } from '../hooks/useGifts'
import { useIsWide } from '../hooks/useIsWide'
import { formatIsoDate } from '../lib/dates'
import type { GiftTotals } from '../lib/gifts'
import { formatCents, moneyColor } from '../lib/money'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'

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

/** A thin spend progress bar for a gift row (red once over budget). */
export function GiftSpendBar({ totals, label }: { totals: GiftTotals; label: string }) {
  const { percent, color } = progress(totals)
  return <Progress value={percent} color={color} size={4} aria-label={`${label} spend`} />
}

/**
 * A gift list row: a dense table-like `ListRow` from the `sm` breakpoint up and
 * a compact bordered card below it, with `caption` beneath the columns.
 */
export function GiftCompactRow({
  wide,
  caption,
  children,
}: {
  wide: boolean
  caption?: ReactNode
  children: ReactNode
}) {
  if (wide) {
    return <ListRow caption={caption}>{children}</ListRow>
  }
  return (
    <AppCard withBorder padding="xs">
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          {children}
        </Group>
        {caption}
      </Stack>
    </AppCard>
  )
}

/**
 * One purchase as a compact row (a card on mobile) with edit/delete controls. A
 * purchase linked from a synced Up transaction is marked, so a card purchase
 * reads apart from a typed one. An ad hoc purchase optionally tagged with a
 * recipient shows that tag as a badge — record-keeping only, so it reads apart
 * from the transaction-linked badge. An ad hoc purchase also offers an Assign
 * action, moving it out of the buffer and into a specific recipient's gift
 * budget once one is known.
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
  const wide = useIsWide()
  const title = (
    <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text size="sm" fw={600} truncate>
          {purchase.description || 'Purchase'}
        </Text>
        {!wide && (
          <Text size="xs" c="dimmed">
            {formatIsoDate(purchase.purchased_on)}
          </Text>
        )}
      </Stack>
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
  )
  const actions = (
    <Group
      gap="xxs"
      wrap="nowrap"
      justify="flex-end"
      style={{ flexShrink: 0, ...(wide && { width: '6rem' }) }}
    >
      {onAssign && (
        <ActionIcon
          variant="subtle"
          aria-label={`Assign ${purchase.description || 'purchase'}`}
          onClick={onAssign}
        >
          <IconGift size={16} />
        </ActionIcon>
      )}
      <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
    </Group>
  )
  return (
    <GiftCompactRow wide={wide}>
      {title}
      {wide && (
        <Text size="sm" c="dimmed" style={{ width: '6rem', flexShrink: 0 }}>
          {formatIsoDate(purchase.purchased_on)}
        </Text>
      )}
      <MoneyText
        cents={purchase.amount_cents}
        size="sm"
        fw={600}
        ta="right"
        style={{ flexShrink: 0, ...(wide && { width: '6rem' }) }}
      />
      {actions}
    </GiftCompactRow>
  )
}
