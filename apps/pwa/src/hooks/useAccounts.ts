import { useCallback, useEffect, useState } from 'react'
import type { TablesInsert, TablesUpdate } from '../lib/database.types'
import type { Account } from '../lib/domain'
import { supabase } from '../lib/supabase'

export type { Account }

export interface UseAccountsResult {
  accounts: Account[] | null
  loading: boolean
  reload: () => Promise<void>
  insert: (account: Omit<TablesInsert<'accounts'>, 'household_id'>) => Promise<string>
  update: (id: string, changes: TablesUpdate<'accounts'>) => Promise<void>
  /**
   * Deletes an account (its balance cascades). RLS allows this for a shared or
   * self-owned row; used to remove an Up account Up has dropped once its
   * dependencies are cleared.
   */
  remove: (id: string) => Promise<void>
  /** Upserts an account's balance in `account_balance`, keyed on the account id. */
  upsertBalance: (accountId: string, balanceCents: number) => Promise<void>
}

/**
 * Loads the household's accounts with their balances and inserts/updates the
 * manual ones that back a balance (e.g. a member's super). RLS scopes reads to
 * the balance-visible set. The net worth view sums every account's
 * `balance_cents`.
 */
export function useAccounts(householdId: string): UseAccountsResult {
  const [accounts, setAccounts] = useState<Account[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('accounts_with_balance').select('*').order('name')
    if (error) {
      throw error
    }
    // The view never returns a null in these columns; see `Account` in domain.ts.
    setAccounts(data as Account[])
  }, [])

  const insert = useCallback(
    async (account: Omit<TablesInsert<'accounts'>, 'household_id'>) => {
      const { data, error } = await supabase
        .from('accounts')
        .insert({ ...account, household_id: householdId })
        .select('id')
        .single()
      if (error) {
        throw error
      }
      await reload()
      return data.id
    },
    [householdId, reload],
  )

  const update = useCallback(
    async (id: string, changes: TablesUpdate<'accounts'>) => {
      const { error } = await supabase.from('accounts').update(changes).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('accounts').delete().eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [reload],
  )

  const upsertBalance = useCallback(
    async (accountId: string, balanceCents: number) => {
      const { error } = await supabase
        .from('account_balance')
        .upsert(
          { account_id: accountId, household_id: householdId, balance_cents: balanceCents },
          { onConflict: 'account_id' },
        )
      if (error) {
        throw error
      }
      await reload()
    },
    [householdId, reload],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { accounts, loading: accounts === null, reload, insert, update, remove, upsertBalance }
}
