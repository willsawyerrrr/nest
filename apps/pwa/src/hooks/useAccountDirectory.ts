import { useHouseholdId } from '../components/HouseholdProvider'
import type { AccountDirectoryRow } from '../lib/domain'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

export type AccountDirectoryEntry = Pick<
  AccountDirectoryRow,
  'id' | 'name' | 'type' | 'source' | 'owner_member_id' | 'deleted_from_source_at'
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
 * balance stays private. An `accounts` write from {@link useAccounts} invalidates
 * this view's cache prefix too.
 */
export function useAccountDirectory(): UseAccountDirectoryResult {
  const householdId = useHouseholdId()

  const { data, loading, reload } = useHouseholdQuery(
    ['account_directory', householdId, 'all'],
    async () => {
      const { data, error } = await supabase
        .from('account_directory')
        .select('id,name,type,source,owner_member_id,deleted_from_source_at')
        .order('name')
      if (error) {
        throw error
      }
      // The view never returns a null in these columns; see domain.ts.
      return data as AccountDirectoryEntry[]
    },
  )

  return { accounts: data ?? null, loading, reload }
}
