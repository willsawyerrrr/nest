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
import { formatIsoDate } from '../lib/dates'
import type { GiftRow } from '../lib/gifts'
import { formatCents } from '../lib/money'
import { AppCard } from './AppCard'
import { EmptyState } from './EmptyState'
import { GiftBudgetForm } from './GiftBudgetForm'
import { GiftPurchaseForm } from './GiftPurchaseForm'
import { GiftMoneyBar, PurchaseRow } from './GiftRowParts'

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
      <AppCard withBorder padding="xs">
        <Stack gap="xxs">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <Text fw={600} size="sm" truncate>
                {row.label}
              </Text>
              {row.date && (
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                  {formatIsoDate(row.date)}
                </Text>
              )}
            </Group>
            <Text size="sm" fw={600} style={{ flexShrink: 0 }}>
              {formatCents(row.budgetedCents)}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            Spending on this gift is hidden from you — this is a gift for you.
          </Text>
          {editingBudget ? (
            budgetEditForm
          ) : (
            <Group gap="xs">
              <Button size="xs" variant="subtle" onClick={() => setEditingBudget(true)}>
                Edit budget
              </Button>
            </Group>
          )}
        </Stack>
      </AppCard>
    )
  }

  return (
    <AppCard withBorder padding="xs">
      <Stack gap="xs">
        <UnstyledButton onClick={toggle} aria-expanded={opened}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              {opened ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
              <Text fw={600} size="sm" truncate>
                {row.label}
              </Text>
              {row.date && (
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                  {formatIsoDate(row.date)}
                </Text>
              )}
            </Group>
          </Group>
        </UnstyledButton>

        <GiftMoneyBar totals={row} label={row.label} />

        <Collapse expanded={opened}>
          <Stack gap="xs" pt="xs">
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
      </Stack>

      {modal}
    </AppCard>
  )
}
