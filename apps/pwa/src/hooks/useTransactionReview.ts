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

/** The transactions a bulk action could not save, each with the code that picks its copy. */
export interface BulkOutcome {
  failed: { id: string; code: string | null }[]
}

/** The most `review_transaction` calls a bulk action has in flight at once. */
const REVIEW_CONCURRENCY = 5

/** The most transactions one `up-categorise` request takes. */
const CATEGORISE_BATCH = 100

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
  /** Marks each transaction reviewed, keeping its note. Resolves with the ones that failed. */
  reviewMany: (transactionIds: readonly string[]) => Promise<BulkOutcome>
  /**
   * Sets one Up category on each transaction, then marks the ones Up took
   * reviewed. Resolves with the ones that failed at either step.
   */
  categoriseMany: (
    transactionIds: readonly string[],
    categoryId: string | null,
  ) => Promise<BulkOutcome>
}

/** Marks each transaction reviewed, a few at a time, returning the ones the database refused. */
async function markReviewed(ids: readonly string[]): Promise<BulkOutcome['failed']> {
  const failed: BulkOutcome['failed'] = []
  const queue = [...ids]
  async function worker() {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const { error } = await supabase.rpc('review_transaction', { p_transaction_id: id })
      if (error) {
        failed.push({ id, code: null })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REVIEW_CONCURRENCY, ids.length) }, worker))
  return ids.flatMap((id) => failed.filter((failure) => failure.id === id))
}

/**
 * Sets the category on Up through `up-categorise`'s batch form, up to
 * {@link CATEGORISE_BATCH} at a time. Returns the ids Up and Nest both took and
 * the ones that failed; a request-wide failure fails its whole batch.
 */
async function categoriseBatches(
  ids: readonly string[],
  categoryId: string | null,
): Promise<{ done: string[]; failed: BulkOutcome['failed'] }> {
  const done: string[] = []
  const failed: BulkOutcome['failed'] = []
  for (let start = 0; start < ids.length; start += CATEGORISE_BATCH) {
    const batch = ids.slice(start, start + CATEGORISE_BATCH)
    const { data, error } = await supabase.functions.invoke<{
      results: { transaction_id: string; code?: string }[]
    }>('up-categorise', { body: { transaction_ids: batch, category_id: categoryId } })
    if (error || !data) {
      const code = error ? await functionFailureCode(error) : null
      failed.push(...batch.map((id) => ({ id, code })))
      continue
    }
    for (const id of batch) {
      const result = data.results.find((item) => item.transaction_id === id)
      if (result && result.code === undefined) {
        done.push(id)
      } else {
        failed.push({ id, code: result?.code ?? null })
      }
    }
  }
  return { done, failed }
}

/**
 * Loads the signed-in member's transactions awaiting review, the one `?id=`
 * focuses, and Up's categories, and saves a review. RLS scopes the reads to the
 * member's balance-visible accounts.
 *
 * A category change goes to Up through `up-categorise` before the review is
 * recorded through `review_transaction`, so a failed change leaves the
 * transaction unreviewed. That includes `save_failed`, where Up took the
 * category but Nest's copy kept the old one: no later sync corrects it, so the
 * member saves again, which sets the same category on Up and retries the copy.
 * The bulk actions follow the same order per transaction: one that fails
 * either step stays unreviewed and is reported back.
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

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transaction_review', householdId] }),
        queryClient.invalidateQueries({ queryKey: ['transactions', householdId] }),
      ]),
    [queryClient, householdId],
  )

  const reviewMany = useCallback(
    async (transactionIds: readonly string[]) => {
      const failed = await markReviewed(transactionIds)
      await refresh()
      return { failed }
    },
    [refresh],
  )

  const categoriseMany = useCallback(
    async (transactionIds: readonly string[], categoryId: string | null) => {
      const categorised = await categoriseBatches(transactionIds, categoryId)
      const unreviewed = await markReviewed(categorised.done)
      await refresh()
      const failed = [...categorised.failed, ...unreviewed]
      return { failed: transactionIds.flatMap((id) => failed.filter((f) => f.id === id)) }
    },
    [refresh],
  )

  return {
    transactions: list.data ?? null,
    focused: focus.data ?? null,
    categories: categories.data ?? null,
    loading: list.loading || focus.loading || categories.loading,
    review,
    reviewMany,
    categoriseMany,
  }
}
