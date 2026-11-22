import { SALARY_CREDIT_COLUMNS, salaryCreditBounds, type SalaryCreditRow } from '../lib/netPay'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

/**
 * The household's `income` credits around `financialYear` — every candidate for a
 * salary credit; `null` until loaded. RLS scopes the read to the balance-visible
 * accounts, so a co-member's pay into their own spending account never arrives.
 */
export function useSalaryCredits(financialYear: number): {
  credits: SalaryCreditRow[] | null
  loading: boolean
} {
  const { from, to } = salaryCreditBounds(financialYear)
  const { data, loading } = useHouseholdQuery(
    ['transactions', 'salary-credits', financialYear],
    async (): Promise<SalaryCreditRow[]> => {
      const { data: rows, error } = await supabase
        .from('transactions')
        .select(SALARY_CREDIT_COLUMNS)
        .eq('kind', 'income')
        .gt('amount_cents', 0)
        .gte('posted_at', from)
        .lt('posted_at', to)
        .order('posted_at')
      if (error) {
        throw error
      }
      return rows as SalaryCreditRow[]
    },
  )
  return { credits: data ?? null, loading }
}
