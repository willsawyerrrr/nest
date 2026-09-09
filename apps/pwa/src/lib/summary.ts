import { summariseHouseholdFromRows } from '@nest/household'
import type { BudgetSummary } from '@nest/plan'
import type { Account } from '../hooks/useAccounts'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { DeductionRow } from '../hooks/useDeductions'
import type { Goal } from '../hooks/useGoals'
import type { HelpDebt } from '../hooks/useHelpDebts'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution } from '../hooks/useSuperContributions'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import type { DerivedAmountContext } from './breakdowns'
import { applyBreakdownAmounts } from './derivedBudget'

/** The household rows the reconciliation and its tax estimate are built from. */
export interface HouseholdSummarySources {
  inflows: Inflow[]
  budgetLines: BudgetLine[]
  taxProfiles: TaxProfile[]
  contributions: SuperContribution[]
  helpDebts: HelpDebt[]
  deductions: DeductionRow[]
  members: readonly Pick<Member, 'id' | 'date_of_birth'>[]
  /** Savings goals — a goal modelling an interest rate feeds projected interest into the tax estimate. */
  goals: readonly Goal[]
  /** Accounts with balances — resolves a goal's linked saver balance and its ownership for interest attribution. */
  accounts: readonly Pick<Account, 'id' | 'balance_cents' | 'owner_member_id'>[]
  derivedAmounts: DerivedAmountContext
  temporaryItems: TemporaryItem[]
  now?: Date
}

/**
 * The whole Summary reconciliation from the household's (possibly sandboxed)
 * rows. Each breakdown- and gift-derived budget line is first resolved to its
 * rolled-up annual amount ({@link applyBreakdownAmounts}), so a derived line and
 * its roll-up stay one source of truth; the resolved rows then go through the
 * shared `summariseHouseholdFromRows`, which the fortnightly-buffer edge
 * functions also call, so the Summary tab, the planning roll-up, and Siri agree
 * by construction. Pure — the Summary tab and the planning roll-up both call it,
 * once per row set, and in planning mode the baseline and proposed rows each run
 * the same path, so a sandbox date edit moves the buffer.
 */
export function summariseHousehold({
  inflows,
  budgetLines,
  taxProfiles,
  contributions,
  helpDebts,
  deductions,
  members,
  goals,
  accounts,
  derivedAmounts,
  temporaryItems,
  now = new Date(),
}: HouseholdSummarySources): BudgetSummary {
  return summariseHouseholdFromRows(
    {
      inflows,
      taxProfiles,
      contributions,
      helpDebts,
      deductions,
      members,
      budgetLines: applyBreakdownAmounts(budgetLines, derivedAmounts),
      temporaryItems,
      savingsGoals: goals,
      savers: accounts,
    },
    now,
  )
}
