import { useCallback } from 'react'
import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type GiftRecipient = Tables<'gift_recipient'>
export type GiftOccasion = Tables<'gift_occasion'>
export type GiftBudget = Tables<'gift_budget'>
export type GiftPurchase = Tables<'gift_purchase'>

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
  gift_budget_id: string
  amount_cents: number
  description: string
  purchased_on: string
}

export interface UseGiftsResult {
  recipients: GiftRecipient[] | null
  occasions: GiftOccasion[] | null
  budgets: GiftBudget[] | null
  purchases: GiftPurchase[] | null
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
}

/**
 * Loads and mutates the household's gift recipients, occasions, budgets, and
 * purchases. RLS scopes reads to the household. Each write refreshes its own
 * table; a delete additionally refreshes the sibling tables its cascade
 * reaches — deleting a recipient or an occasion cascades to gift budgets and
 * their purchases, and deleting a budget cascades to its purchases.
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
  })
  const {
    rows: budgetRows,
    reload: reloadBudgets,
    create: createBudget,
    update: updateBudget,
    remove: removeBudgetRow,
  } = useHouseholdCollection<'gift_budget', GiftBudgetInput>(householdId, {
    table: 'gift_budget',
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
  })

  const reload = useCallback(async () => {
    await Promise.all([reloadRecipients(), reloadOccasions(), reloadBudgets(), reloadPurchases()])
  }, [reloadRecipients, reloadOccasions, reloadBudgets, reloadPurchases])

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
    loading:
      recipientRows === null ||
      occasionRows === null ||
      budgetRows === null ||
      purchaseRows === null,
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
  }
}
