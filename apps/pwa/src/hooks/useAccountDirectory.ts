import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type AccountDirectoryEntry = Pick<
  Tables<'account_directory'>,
  'id' | 'name' | 'type' | 'source' | 'owner_member_id'
>

export interface UseAccountDirectoryResult {
  accounts: AccountDirectoryEntry[] | null
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loads account identity (no balance) from the `account_directory` view: shared
 * accounts, the caller's own accounts, and every member's transaction accounts.
 * RLS scopes reads to the household. Used where a surface needs an account's name
 * and kind but not its balance, so a co-member's account resolves while its
 * balance stays private.
 */
export function useAccountDirectory(): UseAccountDirectoryResult {
  const [accounts, setAccounts] = useState<AccountDirectoryEntry[] | null>(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('account_directory')
      .select('id,name,type,source,owner_member_id')
      .order('name')
    if (error) {
      throw error
    }
    setAccounts(data)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { accounts, loading: accounts === null, reload }
}
