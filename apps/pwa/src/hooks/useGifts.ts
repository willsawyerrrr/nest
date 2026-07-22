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
 * purchases. RLS scopes reads to the household. Every write reloads the whole
 * set so derived rollups stay in step (deletes cascade in the database).
 */
export function useGifts(householdId: string): UseGiftsResult {
  const {
    rows: recipientRows,
    reload: reloadRecipients,
    create: createRecipientRow,
    update: updateRecipientRow,
    remove: removeRecipientRow,
  } = useHouseholdCollection<'gift_recipient', GiftRecipientInput>(householdId, {
    table: 'gift_recipient',
    orderBy: 'name',
  })
  const {
    rows: occasionRows,
    reload: reloadOccasions,
    create: createOccasionRow,
    update: updateOccasionRow,
    remove: removeOccasionRow,
  } = useHouseholdCollection<'gift_occasion', GiftOccasionInput>(householdId, {
    table: 'gift_occasion',
    orderBy: ['occasion_date', 'name'],
  })
  const {
    rows: budgetRows,
    reload: reloadBudgets,
    create: createBudgetRow,
    update: updateBudgetRow,
    remove: removeBudgetRow,
  } = useHouseholdCollection<'gift_budget', GiftBudgetInput>(householdId, {
    table: 'gift_budget',
  })
  const {
    rows: purchaseRows,
    reload: reloadPurchases,
    create: createPurchaseRow,
    update: updatePurchaseRow,
    remove: removePurchaseRow,
  } = useHouseholdCollection<'gift_purchase', GiftPurchaseInput>(householdId, {
    table: 'gift_purchase',
    orderBy: 'purchased_on',
  })

  const reload = useCallback(async () => {
    await Promise.all([reloadRecipients(), reloadOccasions(), reloadBudgets(), reloadPurchases()])
  }, [reloadRecipients, reloadOccasions, reloadBudgets, reloadPurchases])

  const createRecipient = useCallback(
    async (input: GiftRecipientInput) => {
      await createRecipientRow(input)
      await Promise.all([reloadOccasions(), reloadBudgets(), reloadPurchases()])
    },
    [createRecipientRow, reloadOccasions, reloadBudgets, reloadPurchases],
  )
  const updateRecipient = useCallback(
    async (id: string, input: GiftRecipientInput) => {
      await updateRecipientRow(id, input)
      await Promise.all([reloadOccasions(), reloadBudgets(), reloadPurchases()])
    },
    [updateRecipientRow, reloadOccasions, reloadBudgets, reloadPurchases],
  )
  const removeRecipient = useCallback(
    async (id: string) => {
      await removeRecipientRow(id)
      await Promise.all([reloadOccasions(), reloadBudgets(), reloadPurchases()])
    },
    [removeRecipientRow, reloadOccasions, reloadBudgets, reloadPurchases],
  )

  const createOccasion = useCallback(
    async (input: GiftOccasionInput) => {
      await createOccasionRow(input)
      await Promise.all([reloadRecipients(), reloadBudgets(), reloadPurchases()])
    },
    [createOccasionRow, reloadRecipients, reloadBudgets, reloadPurchases],
  )
  const updateOccasion = useCallback(
    async (id: string, input: GiftOccasionInput) => {
      await updateOccasionRow(id, input)
      await Promise.all([reloadRecipients(), reloadBudgets(), reloadPurchases()])
    },
    [updateOccasionRow, reloadRecipients, reloadBudgets, reloadPurchases],
  )
  const removeOccasion = useCallback(
    async (id: string) => {
      await removeOccasionRow(id)
      await Promise.all([reloadRecipients(), reloadBudgets(), reloadPurchases()])
    },
    [removeOccasionRow, reloadRecipients, reloadBudgets, reloadPurchases],
  )

  const createBudget = useCallback(
    async (input: GiftBudgetInput) => {
      await createBudgetRow(input)
      await Promise.all([reloadRecipients(), reloadOccasions(), reloadPurchases()])
    },
    [createBudgetRow, reloadRecipients, reloadOccasions, reloadPurchases],
  )
  const updateBudget = useCallback(
    async (id: string, input: GiftBudgetInput) => {
      await updateBudgetRow(id, input)
      await Promise.all([reloadRecipients(), reloadOccasions(), reloadPurchases()])
    },
    [updateBudgetRow, reloadRecipients, reloadOccasions, reloadPurchases],
  )
  const removeBudget = useCallback(
    async (id: string) => {
      await removeBudgetRow(id)
      await Promise.all([reloadRecipients(), reloadOccasions(), reloadPurchases()])
    },
    [removeBudgetRow, reloadRecipients, reloadOccasions, reloadPurchases],
  )

  const createPurchase = useCallback(
    async (input: GiftPurchaseInput) => {
      await createPurchaseRow(input)
      await Promise.all([reloadRecipients(), reloadOccasions(), reloadBudgets()])
    },
    [createPurchaseRow, reloadRecipients, reloadOccasions, reloadBudgets],
  )
  const updatePurchase = useCallback(
    async (id: string, input: GiftPurchaseInput) => {
      await updatePurchaseRow(id, input)
      await Promise.all([reloadRecipients(), reloadOccasions(), reloadBudgets()])
    },
    [updatePurchaseRow, reloadRecipients, reloadOccasions, reloadBudgets],
  )
  const removePurchase = useCallback(
    async (id: string) => {
      await removePurchaseRow(id)
      await Promise.all([reloadRecipients(), reloadOccasions(), reloadBudgets()])
    },
    [removePurchaseRow, reloadRecipients, reloadOccasions, reloadBudgets],
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
