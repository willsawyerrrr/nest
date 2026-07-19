import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '../lib/database.types'

export type Account = Tables<'accounts'>

export interface UseAccountsResult {
  accounts: Account[] | null
  loading: boolean
  reload: () => Promise<void>
  insert: (account: Omit<TablesInsert<'accounts'>, 'household_id'>) => Promise<string>
  update: (id: string, changes: TablesUpdate<'accounts'>) => Promise<void>
}

/**
 * Loads the household's accounts and inserts/updates the manual ones that back a
 * balance (e.g. a member's super). RLS scopes reads to the household. The net
 * worth view sums every account's `balance_cents`.
 */
export function useAccounts(householdId: string): UseAccountsResult {
  const [accounts, setAccounts] = useState<Account[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('accounts').select('*').order('name')
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

  useEffect(() => {
    void reload()
  }, [reload])

  return { accounts, loading: accounts === null, reload, insert, update }
}
