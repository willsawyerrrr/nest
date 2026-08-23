import { useState } from 'react'
import { Button, Collapse, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type {
  GiftBudget,
  GiftDiscretionaryBudget,
  GiftDiscretionaryBudgetInput,
  GiftOccasion,
  GiftPurchase,
  GiftPurchaseInput,
  GiftRecipient,
} from '../hooks/useGifts'
import { linkableGiftRecipients } from '../lib/giftCandidates'
import { discretionaryTotals } from '../lib/gifts'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { EmptyState } from './EmptyState'
import { GiftPurchaseAssignForm } from './GiftPurchaseAssignForm'
import { GiftPurchaseForm } from './GiftPurchaseForm'
import { GiftMoneyBar, PurchaseRow } from './GiftRowParts'
import { MoneyInput } from './MoneyInput'

/** Inline editable amount for the household's discretionary gift buffer. */
function BudgetAmountEditor({
  budgetedCents,
  onSave,
}: {
  budgetedCents: number
  onSave: (amountCents: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState<number | string>(centsToDollars(budgetedCents))
  const [saving, setSaving] = useState(false)

  if (!editing) {
    return (
      <Group>
        <Button
          size="xs"
          variant="subtle"
          onClick={() => {
            setAmount(centsToDollars(budgetedCents))
            setEditing(true)
          }}
        >
          Edit budget
        </Button>
      </Group>
    )
  }

  return (
    <Group gap="xs" align="flex-end" wrap="wrap">
      <MoneyInput
        label="Budgeted amount"
        size="sm"
        min={0}
        hideControls
        value={amount}
        onChange={setAmount}
      />
      <Button
        size="xs"
        disabled={amount === '' || saving}
        onClick={async () => {
          setSaving(true)
          try {
            await onSave(dollarsToCents(amount) ?? 0)
            setEditing(false)
          } finally {
            setSaving(false)
          }
        }}
      >
        Save
      </Button>
      <Button size="xs" variant="default" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </Group>
  )
}

interface GiftDiscretionaryCardProps {
  discretionaryBudget: GiftDiscretionaryBudget | null
  purchases: GiftPurchase[]
  recipients: GiftRecipient[]
  /** Every gift budget, so an ad hoc purchase can be assigned to one. */
  budgets: GiftBudget[]
  occasions: GiftOccasion[]
  /** Budget ids whose gift is for the signed-in member (spend hidden from them). */
  hiddenBudgetIds: Set<string>
  onUpsertBudget: (input: GiftDiscretionaryBudgetInput) => Promise<void>
  onCreatePurchase: (input: GiftPurchaseInput) => Promise<void>
  onUpdatePurchase: (id: string, input: GiftPurchaseInput) => Promise<void>
  onDeletePurchase: (id: string) => Promise<void>
}

/**
 * The household's ad hoc gift buffer: a planned amount not linked to any
 * recipient's or occasion's gift budget, with its own purchase log — the place
 * to log a purpose-less gift purchase (wrapping paper, bags) throughout the
 * year without picking a recipient up front. Always visible, outside the
 * occasion/person grouping. A purchase may optionally tag a recipient for
 * record-keeping only — RLS hides a purchase tagged to a member's own linked
 * recipient from them, exactly as a budget-linked purchase for their own gift
 * is hidden, so what this card shows already reflects that: nothing further is
 * hidden client-side.
 *
 * Once a purchase's real recipient and occasion are known, Assign moves it out
 * of the buffer and into that pairing's gift budget — the same recipient →
 * occasion choice the gift inbox offers when linking a synced transaction, so
 * only a recipient with an existing budget can be chosen.
 *
 * The buffer row is created lazily on its first edit; adding a purchase waits
 * until then, since a purchase must reference an existing buffer row.
 */
export function GiftDiscretionaryCard({
  discretionaryBudget,
  purchases,
  recipients,
  budgets,
  occasions,
  hiddenBudgetIds,
  onUpsertBudget,
  onCreatePurchase,
  onUpdatePurchase,
  onDeletePurchase,
}: GiftDiscretionaryCardProps) {
  const [opened, { toggle }] = useDisclosure(false)
  const [addingPurchase, setAddingPurchase] = useState(false)
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null)
  const [assigningPurchaseId, setAssigningPurchaseId] = useState<string | null>(null)
  const { confirm, modal } = useConfirmDelete()

  const adHocPurchases = purchases.filter(
    (purchase) => purchase.gift_discretionary_budget_id !== null,
  )
  const totals = discretionaryTotals(discretionaryBudget, purchases)
  const recipientNameById = new Map(recipients.map((recipient) => [recipient.id, recipient.name]))
  const assignChoices = linkableGiftRecipients(budgets, recipients, occasions, hiddenBudgetIds)

  return (
    <AppCard withBorder padding="sm">
      <Stack gap="sm">
        <UnstyledButton onClick={toggle} aria-expanded={opened}>
          <Stack gap="xxs">
            <Group gap={6} wrap="nowrap">
              {opened ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              <Title order={3} size="h5">
                Ad hoc gifts
              </Title>
            </Group>
            <GiftMoneyBar totals={totals} label="Ad hoc gifts" />
          </Stack>
        </UnstyledButton>

        <Collapse expanded={opened}>
          <Stack gap="xs">
            <BudgetAmountEditor
              budgetedCents={discretionaryBudget?.budgeted_amount_cents ?? 0}
              onSave={(amountCents) => onUpsertBudget({ budgeted_amount_cents: amountCents })}
            />

            {adHocPurchases.length === 0 && !addingPurchase && (
              <EmptyState>No ad hoc purchases yet.</EmptyState>
            )}
            {adHocPurchases.length > 0 && assignChoices.length === 0 && (
              <Text size="xs" c="dimmed">
                Add a gift budget to assign these to a recipient.
              </Text>
            )}
            {adHocPurchases.map((purchase) =>
              editingPurchaseId === purchase.id ? (
                <GiftPurchaseForm
                  key={purchase.id}
                  discretionaryBudgetId={purchase.gift_discretionary_budget_id!}
                  recipients={recipients}
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
                  onSubmit={async (budgetId) => {
                    await onUpdatePurchase(purchase.id, {
                      gift_budget_id: budgetId,
                      gift_discretionary_budget_id: null,
                      recipient_id: null,
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
                  recipientLabel={
                    purchase.recipient_id !== null
                      ? (recipientNameById.get(purchase.recipient_id) ?? 'Unknown')
                      : undefined
                  }
                  onAssign={
                    assignChoices.length > 0
                      ? () => {
                          setAddingPurchase(false)
                          setEditingPurchaseId(null)
                          setAssigningPurchaseId(purchase.id)
                        }
                      : undefined
                  }
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

            {addingPurchase && discretionaryBudget !== null ? (
              <GiftPurchaseForm
                discretionaryBudgetId={discretionaryBudget.id}
                recipients={recipients}
                onSubmit={async (input) => {
                  await onCreatePurchase(input)
                  setAddingPurchase(false)
                }}
                onCancel={() => setAddingPurchase(false)}
              />
            ) : (
              <Stack gap={4}>
                <AddButton
                  label="Add purchase"
                  onClick={() => setAddingPurchase(true)}
                  disabled={discretionaryBudget === null}
                />
                {discretionaryBudget === null && (
                  <Text size="xs" c="dimmed">
                    Set a budget above to start logging purchases.
                  </Text>
                )}
              </Stack>
            )}
          </Stack>
        </Collapse>
      </Stack>

      {modal}
    </AppCard>
  )
}
