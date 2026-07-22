import type { Tables } from '../lib/database.types'
import { useHouseholdUpsertCollection } from './useCollection'

export type HelpDebt = Tables<'help_debt'>

/** The HELP-debt fields a form supplies for a member. */
export interface HelpDebtInput {
  member_id: string
  balance_cents: number
}

export interface UseHelpDebtsResult {
  helpDebts: HelpDebt[] | null
  loading: boolean
  reload: () => Promise<void>
  upsert: (input: HelpDebtInput) => Promise<void>
}

/**
 * Loads and upserts each member's single standing HELP debt, keyed by member.
 * RLS scopes reads to the household. Unlike the tax profile, a HELP balance is
 * not financial-year-scoped.
 */
export function useHelpDebts(householdId: string): UseHelpDebtsResult {
  const { rows, loading, reload, upsert } = useHouseholdUpsertCollection<
    'help_debt',
    HelpDebtInput
  >(householdId, { table: 'help_debt', onConflict: 'member_id' })
  return { helpDebts: rows, loading, reload, upsert }
}
