import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure, useLocalStorage } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import type {
  GiftBudget,
  GiftBudgetInput,
  GiftOccasion,
  GiftOccasionInput,
  GiftPurchase,
  GiftPurchaseInput,
  GiftRecipient,
  GiftRecipientInput,
} from '../hooks/useGifts'
import type { Member } from '../hooks/useMembers'
import { formatIsoDate } from '../lib/dates'
import {
  groupGifts,
  overallGiftTotals,
  pairKey,
  type GiftGroup,
  type GiftGroupBy,
  type GiftRow,
} from '../lib/gifts'
import { formatCents } from '../lib/money'
import { BreakdownPageLayout } from './BreakdownPageLayout'
import { EmptyState } from './EmptyState'
import { EnumSegmentedControl } from './EnumSelect'
import { GiftBudgetForm } from './GiftBudgetForm'
import { GiftManagement } from './GiftManagement'
import { GiftPurchaseForm } from './GiftPurchaseForm'
import { GiftMoneyBar, PurchaseRow } from './GiftRowParts'

interface GiftsScreenProps {
  /** Where the back link returns to. */
  backTo: string
  /** The back link's label, naming its destination. */
  backLabel: string
  recipients: GiftRecipient[]
  occasions: GiftOccasion[]
  budgets: GiftBudget[]
  purchases: GiftPurchase[]
  members: Member[]
  /** The signed-in member's id, or null while unresolved / for a user with no member row. */
  currentMemberId: string | null
  onCreateRecipient: (input: GiftRecipientInput) => Promise<void>
  onUpdateRecipient: (id: string, input: GiftRecipientInput) => Promise<void>
  onDeleteRecipient: (id: string) => Promise<void>
  onCreateOccasion: (input: GiftOccasionInput) => Promise<void>
  onUpdateOccasion: (id: string, input: GiftOccasionInput) => Promise<void>
  onDeleteOccasion: (id: string) => Promise<void>
  onCreateBudget: (input: GiftBudgetInput) => Promise<void>
  onUpdateBudget: (id: string, input: GiftBudgetInput) => Promise<void>
  onDeleteBudget: (id: string) => Promise<void>
  onCreatePurchase: (input: GiftPurchaseInput) => Promise<void>
  onUpdatePurchase: (id: string, input: GiftPurchaseInput) => Promise<void>
  onDeletePurchase: (id: string) => Promise<void>
}

const GROUP_BY_STORAGE_KEY = 'gift-group-by'

/** One pairing row: its money, expandable to its purchases with add/edit/delete and budget edit. */
function GiftRowCard({
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

  // A gift for the signed-in member shows only its agreed (shared) budget: its
  // spend, remaining, and purchase log stay hidden so the surprise is not spoiled.
  if (hidden) {
    return (
      <Card withBorder radius="md" p="xs">
        <Stack gap={4}>
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
            Purchases hidden — this is a gift for you.
          </Text>
        </Stack>
      </Card>
    )
  }

  return (
    <Card withBorder radius="md" p="xs">
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
    </Card>
  )
}

/** One collapsible group: header rollup plus its pairing rows and an add-budget affordance. */
function GiftGroupCard({
  group,
  groupBy,
  budgetsById,
  purchases,
  recipients,
  occasions,
  takenPairs,
  hiddenBudgetIds,
  onCreateBudget,
  onUpdateBudget,
  onDeleteBudget,
  onCreatePurchase,
  onUpdatePurchase,
  onDeletePurchase,
}: {
  group: GiftGroup
  groupBy: GiftGroupBy
  budgetsById: Map<string, GiftBudget>
  purchases: GiftPurchase[]
  recipients: GiftRecipient[]
  occasions: GiftOccasion[]
  takenPairs: Set<string>
  /** Budget ids whose gift is for the signed-in member (spend hidden from them). */
  hiddenBudgetIds: Set<string>
  onCreateBudget: (input: GiftBudgetInput) => Promise<void>
  onUpdateBudget: (id: string, input: GiftBudgetInput) => Promise<void>
  onDeleteBudget: (id: string) => Promise<void>
  onCreatePurchase: (input: GiftPurchaseInput) => Promise<void>
  onUpdatePurchase: (id: string, input: GiftPurchaseInput) => Promise<void>
  onDeletePurchase: (id: string) => Promise<void>
}) {
  const [opened, { toggle }] = useDisclosure(false)
  const [addingBudget, setAddingBudget] = useState(false)

  // A group made up entirely of gifts for the signed-in member shows only its
  // budgeted amount: its spend, remaining, and progress bar stay hidden. A
  // mixed group (some gifts for others) keeps showing its full spend rollup.
  const hiddenGroup =
    group.rows.length > 0 && group.rows.every((row) => hiddenBudgetIds.has(row.budgetId))

  return (
    <Card withBorder radius="md" p="sm">
      <Stack gap="sm">
        <UnstyledButton onClick={toggle} aria-expanded={opened}>
          <Stack gap={4}>
            <Group justify="space-between" wrap="nowrap" gap="sm" align="center">
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                {opened ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                <Title order={3} size="h5" style={{ minWidth: 0 }}>
                  {group.label}
                </Title>
                {group.date && (
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {formatIsoDate(group.date)}
                  </Text>
                )}
              </Group>
            </Group>
            <GiftMoneyBar totals={group} label={group.label} budgetOnly={hiddenGroup} />
          </Stack>
        </UnstyledButton>

        <Collapse expanded={opened}>
          <Stack gap="xs">
            {group.rows.length === 0 && !addingBudget && (
              <EmptyState>No gift budgets yet.</EmptyState>
            )}
            {group.rows.map((row) => {
              const budget = budgetsById.get(row.budgetId)
              if (!budget) {
                // Unreachable: `group.rows` and `budgetsById` are both derived
                // from the same `budgets` prop, so every row's `budgetId`
                // always resolves to a budget here.
                /* v8 ignore next */
                return null
              }
              return (
                <GiftRowCard
                  key={row.budgetId}
                  row={row}
                  budget={budget}
                  purchases={purchases}
                  recipients={recipients}
                  occasions={occasions}
                  takenPairs={takenPairs}
                  hidden={hiddenBudgetIds.has(row.budgetId)}
                  onUpdateBudget={onUpdateBudget}
                  onDeleteBudget={onDeleteBudget}
                  onCreatePurchase={onCreatePurchase}
                  onUpdatePurchase={onUpdatePurchase}
                  onDeletePurchase={onDeletePurchase}
                />
              )
            })}

            {addingBudget ? (
              <GiftBudgetForm
                recipients={recipients}
                occasions={occasions}
                lockedOccasionId={groupBy === 'occasion' ? group.key : undefined}
                lockedRecipientId={groupBy === 'person' ? group.key : undefined}
                takenPairs={takenPairs}
                onSubmit={async (input) => {
                  await onCreateBudget(input)
                  setAddingBudget(false)
                }}
                onCancel={() => setAddingBudget(false)}
              />
            ) : (
              <Button variant="light" fullWidth onClick={() => setAddingBudget(true)}>
                Add gift budget
              </Button>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  )
}

/** Presentational gift tracker: grouped budgets with spend rollups, plus recipient/occasion management. */
export function GiftsScreen({
  backTo,
  backLabel,
  recipients,
  occasions,
  budgets,
  purchases,
  members,
  currentMemberId,
  onCreateRecipient,
  onUpdateRecipient,
  onDeleteRecipient,
  onCreateOccasion,
  onUpdateOccasion,
  onDeleteOccasion,
  onCreateBudget,
  onUpdateBudget,
  onDeleteBudget,
  onCreatePurchase,
  onUpdatePurchase,
  onDeletePurchase,
}: GiftsScreenProps) {
  const [groupBy, setGroupBy] = useLocalStorage<GiftGroupBy>({
    key: GROUP_BY_STORAGE_KEY,
    defaultValue: 'occasion',
    getInitialValueInEffect: false,
  })
  const [managing, { toggle: toggleManaging }] = useDisclosure(false)

  const groups = groupGifts(recipients, occasions, budgets, purchases, groupBy)
  const overall = overallGiftTotals(budgets, purchases)
  const budgetsById = new Map(budgets.map((budget) => [budget.id, budget]))
  const takenPairs = new Set(
    budgets.map((budget) => pairKey(budget.recipient_id, budget.occasion_id)),
  )
  // Gifts for the signed-in member: their recipient is linked to that member, so
  // their spend and purchases are hidden from them (the surprise is preserved).
  const recipientsForMember = new Set(
    currentMemberId === null
      ? []
      : recipients
          .filter((recipient) => recipient.member_id === currentMemberId)
          .map((recipient) => recipient.id),
  )
  const hiddenBudgetIds = new Set(
    budgets
      .filter((budget) => recipientsForMember.has(budget.recipient_id))
      .map((budget) => budget.id),
  )
  // Every gift is for the signed-in member: the overall total shows only its
  // budgeted amount, with no spend, remaining, or progress bar to spoil.
  const allHidden = budgets.length > 0 && budgets.every((budget) => hiddenBudgetIds.has(budget.id))
  const noEntities = recipients.length === 0 && occasions.length === 0

  return (
    <BreakdownPageLayout
      backTo={backTo}
      backLabel={backLabel}
      title="Gifts"
      action={
        <Button variant={managing ? 'filled' : 'default'} onClick={toggleManaging}>
          {managing ? 'Done' : 'Manage'}
        </Button>
      }
    >
      {budgets.length > 0 && (
        <Card withBorder radius="md" p="sm">
          <Stack gap={4}>
            <Title order={3} size="h5">
              Total
            </Title>
            <GiftMoneyBar totals={overall} label="Total gift" budgetOnly={allHidden} />
          </Stack>
        </Card>
      )}

      <Collapse expanded={managing}>
        <GiftManagement
          recipients={recipients}
          occasions={occasions}
          members={members}
          currentMemberId={currentMemberId}
          onCreateRecipient={onCreateRecipient}
          onUpdateRecipient={onUpdateRecipient}
          onDeleteRecipient={onDeleteRecipient}
          onCreateOccasion={onCreateOccasion}
          onUpdateOccasion={onUpdateOccasion}
          onDeleteOccasion={onDeleteOccasion}
        />
      </Collapse>

      <EnumSegmentedControl
        fullWidth
        aria-label="Group gifts by"
        value={groupBy}
        onChange={setGroupBy}
        data={[
          { value: 'occasion', label: 'By occasion' },
          { value: 'person', label: 'By person' },
        ]}
      />

      {noEntities ? (
        <Box>
          <Text c="dimmed" size="sm">
            Add a recipient and an occasion to start tracking gifts. Tap <b>Manage</b> above.
          </Text>
        </Box>
      ) : groups.length === 0 ? (
        <EmptyState>
          No {groupBy === 'occasion' ? 'occasions' : 'recipients'} yet. Tap <b>Manage</b> to add
          one.
        </EmptyState>
      ) : (
        groups.map((group) => (
          <GiftGroupCard
            key={group.key}
            group={group}
            groupBy={groupBy}
            budgetsById={budgetsById}
            purchases={purchases}
            recipients={recipients}
            occasions={occasions}
            takenPairs={takenPairs}
            hiddenBudgetIds={hiddenBudgetIds}
            onCreateBudget={onCreateBudget}
            onUpdateBudget={onUpdateBudget}
            onDeleteBudget={onDeleteBudget}
            onCreatePurchase={onCreatePurchase}
            onUpdatePurchase={onUpdatePurchase}
            onDeletePurchase={onDeletePurchase}
          />
        ))
      )}
    </BreakdownPageLayout>
  )
}
