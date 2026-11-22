import { supabase } from '../lib/supabase'
import { SOURCE_TRANSACTION_COLUMNS, type SourceTransaction } from '../lib/transactionDeduction'
import { useHouseholdQuery } from './useCollection'

/**
 * The ids of the transactions that already have a deduction, in any financial
 * year; `null` until loaded. A write to `deduction` refetches it, so creating or
 * deleting a deduction updates which transactions are marked.
 */
export function useDeductedTransactionIds(): {
  ids: ReadonlySet<string> | null
  loading: boolean
} {
  const { data, loading } = useHouseholdQuery(
    ['deduction', 'transaction-links'],
    async (): Promise<ReadonlySet<string>> => {
      const { data: rows, error } = await supabase
        .from('deduction')
        .select('transaction_id')
        .not('transaction_id', 'is', null)
      if (error) {
        throw error
      }
      return new Set(
        (rows as { transaction_id: string | null }[]).flatMap((row) =>
          row.transaction_id === null ? [] : [row.transaction_id],
        ),
      )
    },
  )
  return { ids: data ?? null, loading }
}

/**
 * The transactions behind `ids`, by id. RLS hides a transaction on a co-member's
 * private account, so an id may be missing from the result; a deduction whose
 * source was deleted has no id to look up.
 */
export function useSourceTransactions(ids: readonly string[]): {
  transactions: Readonly<Record<string, SourceTransaction>>
  loading: boolean
} {
  const sorted = [...new Set(ids)].sort()
  const { data, loading } = useHouseholdQuery(
    ['transactions', 'deduction-sources', sorted.join(',')],
    async (): Promise<Record<string, SourceTransaction>> => {
      if (sorted.length === 0) {
        return {}
      }
      const { data: rows, error } = await supabase
        .from('transactions')
        .select(SOURCE_TRANSACTION_COLUMNS)
        .in('id', sorted)
      if (error) {
        throw error
      }
      return Object.fromEntries((rows as SourceTransaction[]).map((row) => [row.id, row]))
    },
  )
  return { transactions: data ?? {}, loading }
}
