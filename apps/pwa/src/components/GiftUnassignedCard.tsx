import { useState } from 'react'
import { Collapse, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type {
  GiftBudget,
  GiftDiscretionaryBudget,
  GiftOccasion,
  GiftPurchase,
  GiftPurchaseInput,
  GiftRecipient,
} from '../hooks/useGifts'
import { linkableGiftRecipients } from '../lib/giftCandidates'
import { isUnassignedPurchase, unassignedSpentCents } from '../lib/gifts'
import { formatCents } from '../lib/money'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EmptyState } from './EmptyState'
import { GiftPurchaseAssignForm } from './GiftPurchaseAssignForm'
import { GiftPurchaseForm } from './GiftPurchaseForm'
import { PurchaseRow } from './GiftRowParts'

interface GiftUnassignedCardProps {
  purchases: GiftPurchase[]
  budgets: GiftBudget[]
  occasions: GiftOccasion[]
  recipients: GiftRecipient[]
  /** The household's single ad hoc gift buffer row, or null before its first edit. */
  discretionaryBudget: GiftDiscretionaryBudget | null
  /** Budget ids whose gift is for the signed-in member (spend hidden from them). */
  hiddenBudgetIds: Set<string>
  onCreatePurchase: (input: GiftPurchaseInput) => Promise<void>
  onUpdatePurchase: (id: string, input: GiftPurchaseInput) => Promise<void>
  onDeletePurchase: (id: string) => Promise<void>
}

/**
 * Gift purchases logged with no purpose yet — wrapping paper, gift bags,
 * stocking fillers bought throughout the year before a recipient or occasion
 * is decided. Distinct from the ad hoc gifts buffer below, which is a planned
 * amount set aside for genuinely unplanned occasions: this list plans nothing
 * of its own, just a running total of what has been spent awaiting a
 * decision. Each purchase is assigned on — to a specific gift's budget, or
 * into the ad hoc buffer — once that decision is made, at which point it
 * leaves this list and counts against wherever it landed instead.
 *
 * Always visible, outside the occasion/person grouping and above the ad hoc
 * card, since a purchase here has committed to neither.
 */
export function GiftUnassignedCard({
  purchases,
  budgets,
  occasions,
  recipients,
  discretionaryBudget,
  hiddenBudgetIds,
  onCreatePurchase,
  onUpdatePurchase,
  onDeletePurchase,
}: GiftUnassignedCardProps) {
  const [opened, { toggle }] = useDisclosure(false)
  const [addingPurchase, setAddingPurchase] = useState(false)
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null)
  const [assigningPurchaseId, setAssigningPurchaseId] = useState<string | null>(null)
  const { confirm, modal } = useConfirmDelete()

  const unassigned = purchases.filter(isUnassignedPurchase)
  const assignChoices = linkableGiftRecipients(budgets, recipients, occasions, hiddenBudgetIds)
  const total = unassignedSpentCents(purchases)

  return (
    <AppCard withBorder padding="sm">
      <Stack gap="sm">
        <UnstyledButton onClick={toggle} aria-expanded={opened}>
          <Stack gap="xxs">
            <Group gap={6} wrap="nowrap">
              {opened ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              <Title order={3} size="h5">
                Unassigned purchases
              </Title>
            </Group>
            <Text size="xs" c="dimmed">
              Logged so far {formatCents(total)}
            </Text>
          </Stack>
        </UnstyledButton>

        <Collapse expanded={opened}>
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              Gift purchases bought with no recipient or occasion in mind yet — assign each one once
              you know what it&rsquo;s for.
            </Text>

            {unassigned.length === 0 && !addingPurchase && (
              <EmptyState>No unassigned purchases.</EmptyState>
            )}

            {unassigned.map((purchase) =>
              editingPurchaseId === purchase.id ? (
                <GiftPurchaseForm
                  key={purchase.id}
                  initial={purchase}
                  onSubmit={async (input) => {
                    await onUpdatePurchase(purchase.id, input)
                    setEditingPurchaseId(null)
                  }}
                  onCancel={() => setEditingPurchaseId(null)}
                />
              ) : assigningPurchaseId === purchase.id ? (
                <GiftPurchaseAssignForm
                  key={purchase.id}
                  recipientChoices={assignChoices}
                  discretionaryBudgetId={discretionaryBudget?.id ?? null}
                  recipients={recipients}
                  onSubmit={async (assignment) => {
                    await onUpdatePurchase(purchase.id, {
                      ...assignment,
                      amount_cents: purchase.amount_cents,
                      description: purchase.description,
                      purchased_on: purchase.purchased_on,
                    })
                    setAssigningPurchaseId(null)
                  }}
                  onCancel={() => setAssigningPurchaseId(null)}
                />
              ) : (
                <PurchaseRow
                  key={purchase.id}
                  purchase={purchase}
                  onAssign={() => {
                    setAddingPurchase(false)
                    setEditingPurchaseId(null)
                    setAssigningPurchaseId(purchase.id)
                  }}
                  onEdit={() => {
                    setAddingPurchase(false)
                    setAssigningPurchaseId(null)
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
                onSubmit={async (input) => {
                  await onCreatePurchase(input)
                  setAddingPurchase(false)
                }}
                onCancel={() => setAddingPurchase(false)}
              />
            ) : (
              <AddButton label="Add purchase" onClick={() => setAddingPurchase(true)} />
            )}
          </Stack>
        </Collapse>
      </Stack>

      {modal}
    </AppCard>
  )
}
