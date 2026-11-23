import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useHouseholdId } from '../components/HouseholdProvider'
import { functionFailureCode } from '../lib/functionFailure'
import { supabase } from '../lib/supabase'
import {
  REVIEW_PAGE_SIZE,
  REVIEW_TRANSACTION_COLUMNS,
  ReviewError,
  type ReviewTransaction,
  type UpCategory,
} from '../lib/transactionReview'
import { useHouseholdQuery } from './useCollection'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a review saves: the Nest note as typed (blank clears it), and the category when it changed. */
export interface ReviewInput {
  note: string
  /** The Up child category to set, or null to clear it; omitted to leave Up's category as it is. */
  categoryId?: string | null
}

export interface UseTransactionReviewResult {
  /** The unreviewed categorisable Up transactions, newest first, at most {@link REVIEW_PAGE_SIZE}. */
  transactions: ReviewTransaction[] | null
  /** The transaction `?id=` names, whether or not it is reviewed; null when none is named or visible. */
  focused: ReviewTransaction | null
  /** Up's category taxonomy. */
  categories: UpCategory[] | null
  loading: boolean
  /**
   * Marks a transaction reviewed with its note, setting its Up category first
   * when `categoryId` is given. Rejects with a {@link ReviewError}.
   */
  review: (transactionId: string, input: ReviewInput) => Promise<void>
}

/**
 * Loads the signed-in member's transactions awaiting review, the one `?id=`
 * focuses, and Up's categories, and saves a review through
 * {@link useReviewTransaction}. RLS scopes the reads to the member's
 * balance-visible accounts.
 */
export function useTransactionReview(focusId: string | null): UseTransactionReviewResult {
  const householdId = useHouseholdId()
  const validFocusId = focusId !== null && UUID.test(focusId) ? focusId : null

  const list = useHouseholdQuery(['transaction_review', householdId, 'unreviewed'], async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select(REVIEW_TRANSACTION_COLUMNS)
      .eq('source', 'up')
      .eq('is_categorizable', true)
      .is('reviewed_at', null)
      .order('posted_at', { ascending: false })
      .limit(REVIEW_PAGE_SIZE)
    if (error) {
      throw error
    }
    return data as ReviewTransaction[]
  })

  const focus = useHouseholdQuery(
    ['transaction_review', householdId, 'focus', validFocusId ?? ''],
    async () => {
      if (validFocusId === null) {
        return null
      }
      const { data, error } = await supabase
        .from('transactions')
        .select(REVIEW_TRANSACTION_COLUMNS)
        .eq('id', validFocusId)
        .maybeSingle()
      if (error) {
        throw error
      }
      return data as ReviewTransaction | null
    },
  )

  const categories = useUpCategories()
  const review = useReviewTransaction()

  return {
    transactions: list.data ?? null,
    focused: focus.data ?? null,
    categories: categories.categories,
    loading: list.loading || focus.loading || categories.loading,
    review,
  }
}

/** Loads Up's category taxonomy. */
export function useUpCategories(): { categories: UpCategory[] | null; loading: boolean } {
  const householdId = useHouseholdId()
  const { data, loading } = useHouseholdQuery(['up_category', householdId], async () => {
    const { data, error } = await supabase.from('up_category').select('id,name,parent_id')
    if (error) {
      throw error
    }
    return data as UpCategory[]
  })
  return { categories: data ?? null, loading }
}

/**
 * Marks a transaction reviewed with its note, setting its Up category first
 * when `categoryId` is given, then refreshes every cached transaction read.
 * Rejects with a {@link ReviewError}.
 *
 * A category change goes to Up through `up-categorise` before the review is
 * recorded through `review_transaction`, so a failed change leaves the
 * transaction unreviewed. That includes `save_failed`, where Up took the
 * category but Nest's copy kept the old one: no later sync corrects it, so the
 * member saves again, which sets the same category on Up and retries the copy.
 */
export function useReviewTransaction(): (
  transactionId: string,
  input: ReviewInput,
) => Promise<void> {
  const householdId = useHouseholdId()
  const queryClient = useQueryClient()

  return useCallback(
    async (transactionId: string, { note, categoryId }: ReviewInput) => {
      if (categoryId !== undefined) {
        const { error } = await supabase.functions.invoke('up-categorise', {
          body: { transaction_id: transactionId, category_id: categoryId },
        })
        if (error) {
          throw new ReviewError(await functionFailureCode(error))
        }
      }
      const { error } = await supabase.rpc('review_transaction', {
        p_transaction_id: transactionId,
        p_note: note,
      })
      if (error) {
        throw new ReviewError(null)
      }
      // A move into gifts lands the transaction in the Gifts inbox too.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transaction_review', householdId] }),
        queryClient.invalidateQueries({ queryKey: ['transactions', householdId] }),
      ])
    },
    [queryClient, householdId],
  )
}
