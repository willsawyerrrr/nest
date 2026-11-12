/**
 * The net-worth outcome and its projection helpers. The implementation lives in
 * `@nest/household`, shared with the native app.
 */

import type {
  NetWorthComputeInput as SharedInput,
  NetWorthComputeResult as SharedResult,
} from '@nest/household'
import type { Account } from '../hooks/useAccounts'

export {
  combinedHelpCentsByYear,
  computeNetWorth,
  DEFAULT_PROJECTION_HORIZON_YEARS,
  netWorthGoals,
  projectionHorizonYears,
  resolveHorizonYears,
  splitCashAndDebt,
} from '@nest/household'
export type { CashDebtSplit } from '@nest/household'

/** A net-worth outcome over the PWA's accounts. */
export type NetWorthComputeResult = SharedResult<Account>
/** The rows and settings a net-worth outcome is computed from, over the PWA's accounts. */
export type NetWorthComputeInput = SharedInput<Account>
