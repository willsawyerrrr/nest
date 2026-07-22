import { useCallback, useEffect, useState } from 'react'
import type { Tables, TablesInsert, TablesUpdate } from '../lib/database.types'
import { supabase } from '../lib/supabase'

/**
 * An account's identity joined to its balance, read from the
 * `accounts_with_balance` view: the account identity plus `balance_cents`, scoped
 * to the balance-visible set.
 */
export type Account = Tables<'accounts_with_balance'>

export interface UseAccountsResult {
  accounts: Account[] | null
  loading: boolean
  reload: () => Promise<void>
  insert: (account: Omit<TablesInsert<'accounts'>, 'household_id'>) => Promise<string>
  update: (id: string, changes: TablesUpdate<'accounts'>) => Promise<void>
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
    setAccounts(data)
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

  return { accounts, loading: accounts === null, reload, insert, update, upsertBalance }
}
