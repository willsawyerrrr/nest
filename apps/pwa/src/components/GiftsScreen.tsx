import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Collapse,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure, useLocalStorage } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight, IconRefresh } from '@tabler/icons-react'
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
  dismissedGiftCandidates,
  giftCandidates,
  linkableGiftBudgets,
  type GiftTransaction,
  type GiftTransactionDismissal,
} from '../lib/giftCandidates'
import {
  groupGifts,
  overallGiftTotals,
  pairKey,
  type GiftGroup,
  type GiftGroupBy,
} from '../lib/gifts'
import { AddButton } from './AddButton'
import { AppCard } from './AppCard'
import { BreakdownPageLayout } from './BreakdownPageLayout'
import { EmptyState } from './EmptyState'
import { EnumSegmentedControl } from './EnumSelect'
import { GiftBudgetForm } from './GiftBudgetForm'
import { GiftCandidateInbox } from './GiftCandidateInbox'
import { GiftManagement } from './GiftManagement'
import { GiftRowCard } from './GiftRowCard'
import { GiftMoneyBar } from './GiftRowParts'

interface GiftsScreenProps {
  recipients: GiftRecipient[]
  occasions: GiftOccasion[]
  budgets: GiftBudget[]
  purchases: GiftPurchase[]
  /** The synced gift-category transactions the inbox offers, newest first. */
  transactions: GiftTransaction[]
  /** The dismissals keeping the transactions that were not gifts out of the inbox. */
  dismissals: GiftTransactionDismissal[]
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
  /** Sets a candidate aside as "not a gift". */
  onDismissTransaction: (transactionId: string) => Promise<void>
  /** Undoes a set-aside, returning its transaction to the inbox. */
  onRestoreTransaction: (dismissalId: string) => Promise<void>
  /** Pulls fresh gift transactions from Up on demand. */
  onRefresh: () => void
  refreshing: boolean
  refreshError: string | null
}

const GROUP_BY_STORAGE_KEY = 'gift-group-by'

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
    <AppCard withBorder padding="sm">
      <Stack gap="sm">
        <UnstyledButton onClick={toggle} aria-expanded={opened}>
          <Stack gap="xxs">
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
              <AddButton label="Add gift budget" onClick={() => setAddingBudget(true)} />
            )}
          </Stack>
        </Collapse>
      </Stack>
    </AppCard>
  )
}

/**
 * Presentational gift tracker: the card-spending inbox, grouped budgets with
 * spend rollups, and recipient/occasion management. Persistence lives in the
 * caller.
 */
export function GiftsScreen({
  recipients,
  occasions,
  budgets,
  purchases,
  transactions,
  dismissals,
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
  onDismissTransaction,
  onRestoreTransaction,
  onRefresh,
  refreshing,
  refreshError,
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
      title="Gifts"
      action={
        <Group gap="xs">
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={onRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
          <Button variant={managing ? 'filled' : 'default'} onClick={toggleManaging}>
            {managing ? 'Done' : 'Manage'}
          </Button>
        </Group>
      }
    >
      {refreshError && (
        <Alert color="red" variant="light">
          {refreshError}
        </Alert>
      )}

      <GiftCandidateInbox
        candidates={giftCandidates(transactions, purchases, dismissals)}
        dismissed={dismissedGiftCandidates(transactions, dismissals)}
        budgetChoices={linkableGiftBudgets(budgets, recipients, occasions, hiddenBudgetIds)}
        onLink={onCreatePurchase}
        onDismiss={onDismissTransaction}
        onRestore={onRestoreTransaction}
      />

      {budgets.length > 0 && (
        <AppCard withBorder padding="sm">
          <Stack gap="xxs">
            <Title order={3} size="h5">
              Total
            </Title>
            <GiftMoneyBar totals={overall} label="Total gift" budgetOnly={allHidden} />
          </Stack>
        </AppCard>
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
