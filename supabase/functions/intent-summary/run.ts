/**
 * The `intent-summary` flow with its I/O injected, so the shape — resolve the
 * caller's household, load its rows, reconcile the buffer — is unit-tested
 * without a database. `index.ts` wires the real service-role reads.
 *
 * It answers one question: the household's fortnightly after-saving buffer, the
 * exact figure the PWA Summary shows on screen, computed by the shared
 * {@link summariseHouseholdFromRows}.
 */

import type { CallerError } from '../_shared/caller.ts'
import {
  type BudgetSummaryBundle,
  summariseHouseholdFromRows,
} from '../_shared/householdBuffer/summary.ts'

export interface IntentSummaryDeps {
  /** Resolves the caller's household from their JWT, or the error to return. */
  resolveHousehold: () => Promise<{ householdId: string } | { error: CallerError }>
  /** Loads every row the buffer reads for the household. */
  loadBundle: (householdId: string) => Promise<BudgetSummaryBundle>
  now: () => Date
}

export interface IntentSummaryResult {
  status: number
  body: unknown
}

export async function runIntentSummary(deps: IntentSummaryDeps): Promise<IntentSummaryResult> {
  const resolved = await deps.resolveHousehold()
  if ('error' in resolved) {
    return { status: resolved.error.status, body: { error: resolved.error.message } }
  }
  const bundle = await deps.loadBundle(resolved.householdId)
  const summary = summariseHouseholdFromRows(bundle, deps.now())
  return {
    status: 200,
    body: { fortnightlyAfterSavingCents: summary.afterSaving.fortnightlyCents },
  }
}
