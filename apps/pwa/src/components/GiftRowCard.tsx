import { useState } from 'react'
import { Button, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type {
  GiftBudget,
  GiftBudgetInput,
  GiftOccasion,
  GiftPurchase,
  GiftPurchaseInput,
  GiftRecipient,
} from '../hooks/useGifts'
import { useIsWide } from '../hooks/useIsWide'
import { formatIsoDate } from '../lib/dates'
import type { GiftRow } from '../lib/gifts'
import { formatCents, moneyColor } from '../lib/money'
import { EditAction } from './EditAction'
import { EmptyState } from './EmptyState'
import { GiftBudgetForm } from './GiftBudgetForm'
import { GiftPurchaseForm } from './GiftPurchaseForm'
import { GiftCompactRow, GiftSpendBar, PurchaseRow } from './GiftRowParts'
import { MoneyText } from './MoneyText'

/** A gift row's label and date, with an optional expand chevron before it. */
function GiftRowLabel({ row, chevron }: { row: GiftRow; chevron?: 'open' | 'closed' }) {
  return (
    <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
      {chevron === 'open' && <IconChevronDown size={16} style={{ flexShrink: 0 }} />}
      {chevron === 'closed' && <IconChevronRight size={16} style={{ flexShrink: 0 }} />}
      <Text fw={600} size="sm" truncate>
        {row.label}
      </Text>
      {row.date && (
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {formatIsoDate(row.date)}
        </Text>
      )}
    </Group>
  )
}

/** One pairing row: its money, expandable to its purchases with add/edit/delete and budget edit. */
export function GiftRowCard({
  row,
  budget,
  purchases,
  recipients,
  occasions,
  takenPairs,
  hidden,
  onUpdateBudget,
  onDeleteBudget,
  onCreatePurchase,
  onUpdatePurchase,
  onDeletePurchase,
}: {
  row: GiftRow
  budget: GiftBudget
  purchases: GiftPurchase[]
  recipients: GiftRecipient[]
  occasions: GiftOccasion[]
  takenPairs: Set<string>
  /** The gift is for the signed-in member: hide its spend and purchases from them. */
  hidden: boolean
  onUpdateBudget: (id: string, input: GiftBudgetInput) => Promise<void>
  onDeleteBudget: (id: string) => Promise<void>
  onCreatePurchase: (input: GiftPurchaseInput) => Promise<void>
  onUpdatePurchase: (id: string, input: GiftPurchaseInput) => Promise<void>
  onDeletePurchase: (id: string) => Promise<void>
}) {
  const [opened, { toggle }] = useDisclosure(false)
  const [editingBudget, setEditingBudget] = useState(false)
  const [addingPurchase, setAddingPurchase] = useState(false)
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null)
  const { confirm, modal } = useConfirmDelete()
  const wide = useIsWide()

  const rowPurchases = purchases.filter((purchase) => purchase.gift_budget_id === row.budgetId)

  // The agreed budget is jointly planned, so both the buyer and the recipient
  // edit it through the same form.
  const budgetEditForm = (
    <GiftBudgetForm
      recipients={recipients}
      occasions={occasions}
      initial={budget}
      takenPairs={takenPairs}
      onSubmit={async (input) => {
        await onUpdateBudget(row.budgetId, input)
        setEditingBudget(false)
      }}
      onCancel={() => setEditingBudget(false)}
    />
  )

  // A gift for the signed-in member shows only its agreed (shared) budget, which
  // they can edit: its spend, remaining, and purchase log stay hidden so the
  // surprise is not spoiled.
  if (hidden) {
    return (
      <Stack gap="xs">
        <GiftCompactRow
          wide={wide}
          caption="Spending on this gift is hidden from you — this is a gift for you."
        >
          <GiftRowLabel row={row} />
          <MoneyText
            cents={row.budgetedCents}
            size="sm"
            fw={600}
            ta="right"
            style={{ flexShrink: 0, ...(wide && { width: '8rem' }) }}
          />
          <Group gap="xxs" wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
            <EditAction aria-label="Edit budget" onClick={() => setEditingBudget(true)} />
          </Group>
        </GiftCompactRow>
        {editingBudget && budgetEditForm}
      </Stack>
    )
  }

  const remainingColor = moneyColor(row.remainingCents)

  return (
    <Stack gap="xs">
      <GiftCompactRow wide={wide} caption={<GiftSpendBar totals={row} label={row.label} />}>
        <UnstyledButton onClick={toggle} aria-expanded={opened} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <GiftRowLabel row={row} chevron={opened ? 'open' : 'closed'} />
            <Text
              size="sm"
              fw={600}
              ta="right"
              style={{
                flexShrink: 0,
                fontVariantNumeric: 'tabular-nums lining-nums',
                ...(wide && { width: '8rem' }),
              }}
              {...(remainingColor !== undefined && { c: remainingColor })}
            >
              Left {formatCents(row.remainingCents)}
            </Text>
          </Group>
        </UnstyledButton>
      </GiftCompactRow>

      <Collapse expanded={opened}>
        <Stack gap="xs" pl="sm">
          <Text size="xs" c="dimmed">
            Budget {formatCents(row.budgetedCents)} · Spent {formatCents(row.spentCents)}
          </Text>
          {rowPurchases.length === 0 && !addingPurchase && (
            <EmptyState>No purchases yet.</EmptyState>
          )}
          {rowPurchases.map((purchase) =>
            editingPurchaseId === purchase.id ? (
              <GiftPurchaseForm
                key={purchase.id}
                budgetId={row.budgetId}
                initial={purchase}
                onSubmit={async (input) => {
                  await onUpdatePurchase(purchase.id, input)
                  setEditingPurchaseId(null)
                }}
                onCancel={() => setEditingPurchaseId(null)}
              />
            ) : (
              <PurchaseRow
                key={purchase.id}
                purchase={purchase}
                onEdit={() => {
                  setAddingPurchase(false)
                  setEditingPurchaseId(purchase.id)
                }}
                onDelete={() =>
                  confirm({
                    title: 'Delete purchase?',
                    itemLabel: purchase.description || 'Purchase',
                    onConfirm: () => onDeletePurchase(purchase.id),
                  })
                }
              />
            ),
          )}

          {addingPurchase ? (
            <GiftPurchaseForm
              budgetId={row.budgetId}
              onSubmit={async (input) => {
                await onCreatePurchase(input)
                setAddingPurchase(false)
              }}
              onCancel={() => setAddingPurchase(false)}
            />
          ) : editingBudget ? (
            budgetEditForm
          ) : (
            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  setEditingBudget(false)
                  setAddingPurchase(true)
                }}
              >
                Add purchase
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => {
                  setAddingPurchase(false)
                  setEditingBudget(true)
                }}
              >
                Edit budget
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                onClick={() =>
                  confirm({
                    title: 'Delete gift budget?',
                    itemLabel: row.label,
                    description:
                      'This also removes every purchase recorded against it. This cannot be undone.',
                    onConfirm: () => onDeleteBudget(row.budgetId),
                  })
                }
              >
                Delete budget
              </Button>
            </Group>
          )}
        </Stack>
      </Collapse>

      {modal}
    </Stack>
  )
}
