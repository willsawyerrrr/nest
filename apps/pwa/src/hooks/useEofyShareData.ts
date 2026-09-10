import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Account } from './useAccounts'
import type { DeductionReceiptRow } from './useDeductionReceipts'
import type { DeductionRow } from './useDeductions'
import type { Goal } from './useGoals'
import type { HelpDebt } from './useHelpDebts'
import type { Inflow } from './useInflows'
import type { Member } from './useMembers'
import type { PayslipRow } from './usePayslips'
import type { SuperContribution } from './useSuperContributions'
import type { SuperProfile } from './useSuperProfiles'
import type { TaxProfile } from './useTaxProfiles'

/**
 * The `eofy-share` response: the same raw rows `EofySection.tsx` loads for the
 * household's own EOFY tab, typed exactly as the existing hooks' row types so
 * `estimateHouseholdTaxFromRows`, `superCapSummaryFromRows`,
 * `helpPayoffByMember`, `paygWithheldFromRows`, and `payslipCountByMember`
 * (all in `lib/tax.ts`/`lib/payslips.ts`) run unmodified against it.
 */
export interface EofyShareData {
  financialYear: number
  /** `{ id, name, date_of_birth }` only — never email or user_id. */
  members: Pick<Member, 'id' | 'name' | 'date_of_birth'>[]
  inflows: Inflow[]
  taxProfiles: TaxProfile[]
  superContributions: SuperContribution[]
  superProfiles: SuperProfile[]
  helpDebts: HelpDebt[]
  deductions: DeductionRow[]
  deductionReceipts: DeductionReceiptRow[]
  payslips: PayslipRow[]
  savingsGoals: Goal[]
  /** `{ id, owner_member_id, balance_cents }` per account — enough to attribute projected savings interest. */
  accounts: Pick<Account, 'id' | 'owner_member_id' | 'balance_cents'>[]
}

export type EofyShareOutcome =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: EofyShareData }

const GENERIC_ERROR_MESSAGE = 'This share link is invalid or has expired.'

/**
 * Loads a shared EOFY view's data from a validated share token, via the
 * public `eofy-share` edge function. Unlike every other data hook in the app,
 * this reads nothing through Supabase-authenticated RLS: the token itself is
 * the whole of the credential, and the caller carries no session at all.
 */
export function useEofyShareData(token: string): EofyShareOutcome {
  const query = useQuery({
    queryKey: ['eofy-share', token],
    queryFn: async () => {
      const { data, error, response } = await supabase.functions.invoke<EofyShareData>(
        'eofy-share',
        { body: { token } },
      )
      if (error || !data) {
        // A non-2xx carries the function's own specific message as JSON; a
        // transport failure carries no response at all.
        const body = response ? await response.json().catch(() => null) : null
        const message = (body as { error?: unknown } | null)?.error
        throw new Error(typeof message === 'string' && message ? message : GENERIC_ERROR_MESSAGE)
      }
      return data
    },
  })

  if (query.isPending) {
    return { status: 'loading' }
  }
  if (query.isError) {
    return { status: 'error', message: query.error.message }
  }
  return { status: 'ready', data: query.data }
}
