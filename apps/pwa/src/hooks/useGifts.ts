import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '../lib/database.types'

export type GiftRecipient = Tables<'gift_recipient'>
export type GiftOccasion = Tables<'gift_occasion'>
export type GiftBudget = Tables<'gift_budget'>
export type GiftPurchase = Tables<'gift_purchase'>

/** The recipient fields a form supplies; the household is set by the hook. */
export interface GiftRecipientInput {
  name: string
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
  const [recipients, setRecipients] = useState<GiftRecipient[] | null>(null)
  const [occasions, setOccasions] = useState<GiftOccasion[] | null>(null)
  const [budgets, setBudgets] = useState<GiftBudget[] | null>(null)
  const [purchases, setPurchases] = useState<GiftPurchase[] | null>(null)

  const reload = useCallback(async () => {
    const [recipientRes, occasionRes, budgetRes, purchaseRes] = await Promise.all([
      supabase.from('gift_recipient').select('*').order('name'),
      supabase.from('gift_occasion').select('*').order('occasion_date').order('name'),
      supabase.from('gift_budget').select('*'),
      supabase.from('gift_purchase').select('*').order('purchased_on'),
    ])
    for (const res of [recipientRes, occasionRes, budgetRes, purchaseRes]) {
      if (res.error) {
        throw res.error
      }
    }
    setRecipients(recipientRes.data)
    setOccasions(occasionRes.data)
    setBudgets(budgetRes.data)
    setPurchases(purchaseRes.data)
  }, [])

  const createRecipient = useCallback(
    async (input: GiftRecipientInput) => {
      const { error } = await supabase
        .from('gift_recipient')
        .insert({ ...input, household_id: householdId })
      if (error) throw error
      await reload()
    },
    [householdId, reload],
  )

  const updateRecipient = useCallback(
    async (id: string, input: GiftRecipientInput) => {
      const { error } = await supabase.from('gift_recipient').update(input).eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  const removeRecipient = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('gift_recipient').delete().eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  const createOccasion = useCallback(
    async (input: GiftOccasionInput) => {
      const { error } = await supabase
        .from('gift_occasion')
        .insert({ ...input, household_id: householdId })
      if (error) throw error
      await reload()
    },
    [householdId, reload],
  )

  const updateOccasion = useCallback(
    async (id: string, input: GiftOccasionInput) => {
      const { error } = await supabase.from('gift_occasion').update(input).eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  const removeOccasion = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('gift_occasion').delete().eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  const createBudget = useCallback(
    async (input: GiftBudgetInput) => {
      const { error } = await supabase
        .from('gift_budget')
        .insert({ ...input, household_id: householdId })
      if (error) throw error
      await reload()
    },
    [householdId, reload],
  )

  const updateBudget = useCallback(
    async (id: string, input: GiftBudgetInput) => {
      const { error } = await supabase.from('gift_budget').update(input).eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  const removeBudget = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('gift_budget').delete().eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  const createPurchase = useCallback(
    async (input: GiftPurchaseInput) => {
      const { error } = await supabase
        .from('gift_purchase')
        .insert({ ...input, household_id: householdId })
      if (error) throw error
      await reload()
    },
    [householdId, reload],
  )

  const updatePurchase = useCallback(
    async (id: string, input: GiftPurchaseInput) => {
      const { error } = await supabase.from('gift_purchase').update(input).eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  const removePurchase = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('gift_purchase').delete().eq('id', id)
      if (error) throw error
      await reload()
    },
    [reload],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    recipients,
    occasions,
    budgets,
    purchases,
    loading: recipients === null || occasions === null || budgets === null || purchases === null,
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
