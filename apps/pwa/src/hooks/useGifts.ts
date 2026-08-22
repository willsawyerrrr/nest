import { useCallback } from 'react'
import type { Tables } from '../lib/database.types'
import { useHouseholdCollection, useHouseholdUpsertCollection } from './useCollection'

export type GiftRecipient = Tables<'gift_recipient'>
export type GiftOccasion = Tables<'gift_occasion'>
export type GiftBudget = Tables<'gift_budget'>
export type GiftPurchase = Tables<'gift_purchase'>
export type GiftDiscretionaryBudget = Tables<'gift_discretionary_budget'>

/** The recipient fields a form supplies; the household is set by the hook. */
export interface GiftRecipientInput {
  name: string
  /** The household member this recipient is, or null for an external person. */
  member_id: string | null
}

/** The occasion fields a form supplies; the household is set by the hook. */
export interface GiftOccasionInput {
  name: string
  occasion_date: string | null
}

/** The budget fields a form supplies; the household is set by the hook. */
export interface GiftBudgetInput {
  recipient_id: string
  occasion_id: string
  budgeted_amount_cents: number
  event_date: string | null
}

/** The purchase fields a form supplies; the household is set by the hook. */
export interface GiftPurchaseInput {
  /** The gift budget this purchase counts against; omit for an ad hoc purchase against the household's discretionary buffer instead. */
  gift_budget_id?: string | undefined
  /** The household's discretionary gift buffer this ad hoc purchase counts against; omit for a purchase linked to a gift_budget instead. */
  gift_discretionary_budget_id?: string | undefined
  /**
   * The recipient an ad hoc purchase is optionally tagged with, for
   * record-keeping only — never set for a budget-linked purchase, whose
   * recipient is already its gift budget's. `null` clears an existing tag.
   */
  recipient_id?: string | null | undefined
  amount_cents: number
  description: string
  purchased_on: string
  /**
   * The synced Up transaction this purchase was linked from, set when claiming a
   * candidate from the gift inbox. Omitted for a hand-entered purchase, and
   * omitted by an edit so an existing link survives it.
   */
  transaction_id?: string
}

/** The discretionary-budget field a form supplies; the household is set by the hook. */
export interface GiftDiscretionaryBudgetInput {
  budgeted_amount_cents: number
}

export interface UseGiftsResult {
  recipients: GiftRecipient[] | null
  occasions: GiftOccasion[] | null
  budgets: GiftBudget[] | null
  purchases: GiftPurchase[] | null
  /** The household's single ad hoc gift buffer row, or null before its first edit. */
  discretionaryBudget: GiftDiscretionaryBudget | null
  loading: boolean
  reload: () => Promise<void>
  createRecipient: (input: GiftRecipientInput) => Promise<void>
  updateRecipient: (id: string, input: GiftRecipientInput) => Promise<void>
  removeRecipient: (id: string) => Promise<void>
  createOccasion: (input: GiftOccasionInput) => Promise<void>
  updateOccasion: (id: string, input: GiftOccasionInput) => Promise<void>
  removeOccasion: (id: string) => Promise<void>
  createBudget: (input: GiftBudgetInput) => Promise<void>
  updateBudget: (id: string, input: GiftBudgetInput) => Promise<void>
  removeBudget: (id: string) => Promise<void>
  createPurchase: (input: GiftPurchaseInput) => Promise<void>
  updatePurchase: (id: string, input: GiftPurchaseInput) => Promise<void>
  removePurchase: (id: string) => Promise<void>
  /** Creates the household's discretionary gift buffer row, or replaces its amount. */
  upsertDiscretionaryBudget: (input: GiftDiscretionaryBudgetInput) => Promise<void>
}

/**
 * Loads and mutates the household's gift recipients, occasions, budgets,
 * purchases, and its single ad hoc discretionary gift buffer. RLS scopes reads
 * to the household. Each write refreshes its own table; a delete additionally
 * refreshes the sibling tables its cascade reaches — deleting a recipient or an
 * occasion cascades to gift budgets and their purchases, and deleting a budget
 * cascades to its purchases.
 *
 * A gift-recipient, gift-occasion, gift-budget, or discretionary-budget write
 * drives the `budget_line` reconcile trigger, which rewrites the derived gift
 * lines — deleting an occasion cascades its budgets away, changing those lines,
 * and editing the discretionary buffer's amount changes the external ("Gifts
 * (others)") line it folds into — so all four collections also invalidate
 * `budget_line` and the raw-line consumers (the Pay splits tab) refetch. A
 * gift-purchase write is excluded: it changes only spent/remaining, never the
 * derived lines. It invalidates `transactions` instead, since claiming a synced
 * transaction as a purchase takes it out of the gift inbox.
 */
export function useGifts(householdId: string): UseGiftsResult {
  const {
    rows: recipientRows,
    reload: reloadRecipients,
    create: createRecipient,
    update: updateRecipient,
    remove: removeRecipientRow,
  } = useHouseholdCollection<'gift_recipient', GiftRecipientInput>(householdId, {
    table: 'gift_recipient',
    orderBy: 'name',
    alsoInvalidate: ['budget_line'],
  })
  const {
    rows: occasionRows,
    reload: reloadOccasions,
    create: createOccasion,
    update: updateOccasion,
    remove: removeOccasionRow,
  } = useHouseholdCollection<'gift_occasion', GiftOccasionInput>(householdId, {
    table: 'gift_occasion',
    orderBy: ['occasion_date', 'name'],
    alsoInvalidate: ['budget_line'],
  })
  const {
    rows: budgetRows,
    reload: reloadBudgets,
    create: createBudget,
    update: updateBudget,
    remove: removeBudgetRow,
  } = useHouseholdCollection<'gift_budget', GiftBudgetInput>(householdId, {
    table: 'gift_budget',
    alsoInvalidate: ['budget_line'],
  })
  const {
    rows: purchaseRows,
    reload: reloadPurchases,
    create: createPurchase,
    update: updatePurchase,
    remove: removePurchase,
  } = useHouseholdCollection<'gift_purchase', GiftPurchaseInput>(householdId, {
    table: 'gift_purchase',
    orderBy: 'purchased_on',
    alsoInvalidate: ['transactions'],
  })
  const {
    rows: discretionaryBudgetRows,
    reload: reloadDiscretionaryBudget,
    upsert: upsertDiscretionaryBudget,
  } = useHouseholdUpsertCollection<'gift_discretionary_budget', GiftDiscretionaryBudgetInput>(
    householdId,
    {
      table: 'gift_discretionary_budget',
      onConflict: 'household_id',
      alsoInvalidate: ['budget_line'],
    },
  )

  const reload = useCallback(async () => {
    await Promise.all([
      reloadRecipients(),
      reloadOccasions(),
      reloadBudgets(),
      reloadPurchases(),
      reloadDiscretionaryBudget(),
    ])
  }, [reloadRecipients, reloadOccasions, reloadBudgets, reloadPurchases, reloadDiscretionaryBudget])

  const removeRecipient = useCallback(
    async (id: string) => {
      await removeRecipientRow(id)
      await Promise.all([reloadBudgets(), reloadPurchases()])
    },
    [removeRecipientRow, reloadBudgets, reloadPurchases],
  )
  const removeOccasion = useCallback(
    async (id: string) => {
      await removeOccasionRow(id)
      await Promise.all([reloadBudgets(), reloadPurchases()])
    },
    [removeOccasionRow, reloadBudgets, reloadPurchases],
  )
  const removeBudget = useCallback(
    async (id: string) => {
      await removeBudgetRow(id)
      await reloadPurchases()
    },
    [removeBudgetRow, reloadPurchases],
  )

  return {
    recipients: recipientRows,
    occasions: occasionRows,
    budgets: budgetRows,
    purchases: purchaseRows,
    discretionaryBudget: discretionaryBudgetRows?.[0] ?? null,
    loading:
      recipientRows === null ||
      occasionRows === null ||
      budgetRows === null ||
      purchaseRows === null ||
      discretionaryBudgetRows === null,
    reload,
    createRecipient,
    updateRecipient,
    removeRecipient,
    createOccasion,
    updateOccasion,
    removeOccasion,
    createBudget,
    updateBudget,
    removeBudget,
    createPurchase,
    updatePurchase,
    removePurchase,
    upsertDiscretionaryBudget,
  }
}
