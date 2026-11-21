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
 * focuses, and Up's categories, and saves a review. RLS scopes the reads to the
 * member's balance-visible accounts.
 *
 * A category change goes to Up through `up-categorise` before the review is
 * recorded through `review_transaction`, so a refused change leaves the
 * transaction unreviewed. `save_failed` is not a refusal: Up holds the new
 * category and the next sync brings the row in line, so the review goes ahead.
 */
export function useTransactionReview(focusId: string | null): UseTransactionReviewResult {
  const householdId = useHouseholdId()
  const queryClient = useQueryClient()
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

  const categories = useHouseholdQuery(['up_category', householdId], async () => {
    const { data, error } = await supabase.from('up_category').select('id,name,parent_id')
    if (error) {
      throw error
    }
    return data as UpCategory[]
  })

  const review = useCallback(
    async (transactionId: string, { note, categoryId }: ReviewInput) => {
      if (categoryId !== undefined) {
        const { error } = await supabase.functions.invoke('up-categorise', {
          body: { transaction_id: transactionId, category_id: categoryId },
        })
        if (error) {
          const code = await functionFailureCode(error)
          if (code !== 'save_failed') {
            throw new ReviewError(code)
          }
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

  return {
    transactions: list.data ?? null,
    focused: focus.data ?? null,
    categories: categories.data ?? null,
    loading: list.loading || focus.loading || categories.loading,
    review,
  }
}
