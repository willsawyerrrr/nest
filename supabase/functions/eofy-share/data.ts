/**
 * Shapes the EOFY tab's own data set for a tax agent's shared view: the same
 * raw rows `EofySection.tsx` loads through its RLS-scoped hooks — inflows,
 * tax profiles, super contributions and profiles, HELP debts, deductions and
 * their receipts, and payslips — sourced instead from a validated share token.
 *
 * Kept a pure module with its I/O injected — resolving the grant and loading
 * the rows are both deps — so the one ordering that matters here (resolve the
 * token before any table is ever read) is unit-tested without a network.
 * `index.ts` wires the real token resolution and the service-role reads.
 */

import type { CallerError } from '../_shared/caller.ts'
import type { ShareGrant } from '../_shared/shareGrant.ts'

export interface FlowResult {
  status: number
  body: unknown
}

/**
 * A row as PostgREST returns it, passed through untyped: the PWA's own
 * generated `Tables<'x'>` types give each array its shape client-side, exactly
 * as the same JSON shape does when an authenticated hook reads it.
 */
export type Row = Record<string, unknown>

export interface EofyShareRows {
  /**
   * `{ id, name, date_of_birth }` — never email or user_id, which the shared
   * view has no use for. `date_of_birth` is not rendered; it feeds
   * `estimateHouseholdTaxFromRows`'s preservation-age check for a one-off
   * termination payment, so the shared estimate agrees with the household's own.
   */
  members: Row[]
  /** Unfiltered by financial year: proration across a member's inflow history needs the whole set, matching `useInflows`. */
  inflows: Row[]
  taxProfiles: Row[]
  superContributions: Row[]
  superProfiles: Row[]
  /** Unfiltered by financial year: a HELP balance is a standing figure, not FY-scoped, matching `useHelpDebts`. */
  helpDebts: Row[]
  deductions: Row[]
  /** Pre-filtered to the deductions already in scope, unlike `useDeductionReceipts` (which loads every year and lets the caller filter) — nothing here is served for a year outside the share. */
  deductionReceipts: Row[]
  payslips: Row[]
  /**
   * Savings goals, unfiltered by financial year (matching `useGoals`): a goal
   * modelling an interest rate (`annual_interest_bps`) feeds projected savings
   * interest into `estimateHouseholdTaxFromRows` as assessable `other` income,
   * so the shared estimate agrees with the household's own.
   */
  savingsGoals: Row[]
  /**
   * `{ id, owner_member_id, balance_cents }` per household account — the
   * identity joined to its balance, as `accounts_with_balance` gives the
   * household's own tab. Resolves a goal's linked saver balance and its
   * ownership for interest attribution; no balance is rendered anywhere.
   */
  accounts: Row[]
}

export interface EofyShareBody extends EofyShareRows {
  financialYear: number
}

export interface EofyShareDeps {
  /** Resolves the bearer token to its grant, or an error outcome. */
  resolveGrant: (token: string) => Promise<{ grant: ShareGrant } | { error: CallerError }>
  /** Loads every row the shared view needs, scoped to the resolved grant. */
  loadRows: (grant: ShareGrant) => Promise<EofyShareRows>
}

/** Trims a raw body value to a token string, or empty when absent/ill-typed. */
export function normaliseToken(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export async function runEofyShare(rawToken: unknown, deps: EofyShareDeps): Promise<FlowResult> {
  const resolved = await deps.resolveGrant(normaliseToken(rawToken))
  if ('error' in resolved) {
    return { status: resolved.error.status, body: { error: resolved.error.message } }
  }

  const rows = await deps.loadRows(resolved.grant)
  const body: EofyShareBody = { financialYear: resolved.grant.financialYear, ...rows }
  return { status: 200, body }
}
