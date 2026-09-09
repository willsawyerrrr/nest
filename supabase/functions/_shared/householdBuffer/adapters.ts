/**
 * The React-free ports of the PWA Summary's parity adapters — the pieces
 * `apps/pwa/src/lib/summary.ts` layers on top of the tax estimate to reach the
 * exact on-screen fortnightly buffer:
 *
 * - `activeNowTaxableInflows` (from `lib/tax.ts`) — the taxable inflows landing
 *   now, for the fortnightly re-estimate.
 * - `splitAcrossMembers` / `projectedInterestIncomeInputs` (from `lib/tax.ts`) —
 *   a savings goal's modelled interest as synthetic `other` income.
 *
 * The breakdown- and gift-derived budget-line amounts are NOT re-derived here:
 * the `reconcile_derived_lines` triggers keep them canonical in `budget_line`, so
 * the buffer reads the row straight (see `summary.ts`).
 *
 * Row shapes are loose interfaces, as in `tax.ts`: the edge runtime cannot
 * import the PWA's `lib/`. The names match the originals so the correspondence
 * is legible.
 */

import { isActiveOn } from '@nest/plan'
import type { IncomeInput } from '@nest/tax'
import type { InflowRow } from './tax.ts'

// ── activeNowTaxableInflows ────────────────────────────────────────────────

/**
 * The taxable inflows the fortnightly budget basis is estimated over: the income
 * landing NOW, each at its full annual rate. A recurring inflow is kept only
 * while `now` falls within its effective window (either side open-ended), with
 * `starts_on` / `ends_on` cleared so the engine annualises it at the full rate
 * rather than its FY-active share. A ONE-OFF is passed through unchanged — it
 * states a date, not a cadence. Non-taxable inflows are dropped.
 */
export function activeNowTaxableInflows(inflows: readonly InflowRow[], now: Date): InflowRow[] {
  return inflows.flatMap((inflow) => {
    if (!inflow.taxable) {
      return []
    }
    if (inflow.paid_on != null) {
      return [inflow]
    }
    if (!isActiveOn({ startsOn: inflow.starts_on, endsOn: inflow.ends_on }, now)) {
      return []
    }
    return [{ ...inflow, starts_on: null, ends_on: null }]
  })
}

// ── projected savings-interest income ──────────────────────────────────────

/**
 * Splits `cents` equally across `memberIds`, the last member absorbing the
 * remainder cent so the shares sum back to `cents` exactly. An empty list
 * yields an empty array.
 */
export function splitAcrossMembers(cents: number, memberIds: readonly string[]): number[] {
  if (memberIds.length === 0) {
    return []
  }
  const each = Math.floor(cents / memberIds.length)
  return memberIds.map((_, index) =>
    index === memberIds.length - 1 ? cents - each * (memberIds.length - 1) : each
  )
}

/** The `savings_goal` columns projected interest reads. */
export interface InterestGoalRow {
  annual_interest_bps: number | null
  linked_account_id: string | null
  current_balance_cents: number
}

/** A synced Up saver: its balance and (for joint savers, null) its owner. */
export interface SaverRow {
  id: string
  balance_cents: number
  owner_member_id: string | null
}

/** The `members` column interest attribution reads. */
export interface MemberIdRow {
  id: string
}

/**
 * Synthetic `other`-income inputs for each member's share of the household's
 * projected annual savings interest. A goal modelling an effective annual rate
 * (`annual_interest_bps` above zero) adds
 * `startingBalanceCents × annual_interest_bps / 10000`, rounded to cents — a
 * simple non-compounding figure. The starting balance is the linked saver's real
 * `balance_cents` when `linked_account_id` resolves, else the goal's own
 * `current_balance_cents`.
 *
 * A goal linked to an individually-owned saver gives the whole figure to that
 * saver's owner; a goal linked to a joint saver (`owner_member_id` null) or with
 * no resolvable link splits 50/50 across `members`. Each non-zero share becomes
 * one steady, always-active `annual` `other` input.
 */
export function projectedInterestIncomeInputs(
  goals: readonly InterestGoalRow[],
  savers: readonly SaverRow[],
  members: readonly MemberIdRow[],
): IncomeInput[] {
  const accountById = new Map(savers.map((saver) => [saver.id, saver]))
  const memberIds = members.map((member) => member.id)
  const inputs: IncomeInput[] = []
  for (const goal of goals) {
    const bps = goal.annual_interest_bps
    if (bps == null || bps <= 0) {
      continue
    }
    const linked = goal.linked_account_id != null
      ? accountById.get(goal.linked_account_id)
      : undefined
    const startingBalanceCents = linked ? linked.balance_cents : goal.current_balance_cents
    const interestCents = Math.round((startingBalanceCents * bps) / 10_000)
    if (interestCents === 0) {
      continue
    }
    const shares = linked?.owner_member_id != null
      ? [[linked.owner_member_id, interestCents] as const]
      : splitAcrossMembers(interestCents, memberIds).map(
        (cents, index) => [memberIds[index] as string, cents] as const,
      )
    for (const [memberId, amountCents] of shares) {
      if (amountCents !== 0) {
        inputs.push({ memberId, type: 'other', schedule: 'annual', amountCents })
      }
    }
  }
  return inputs
}

// ── budget lines ──────────────────────────────────────────────────────────

/**
 * The `budget_line` columns the buffer reads. A breakdown- or gift-derived
 * line's `amount_cents` (annual) and `frequency = 'annual'` are already
 * canonical — kept in step by the `reconcile_derived_lines` triggers — so the
 * loader reads every line the same way and re-derives nothing.
 */
export interface BudgetLineRow {
  line_group: string
  amount_cents: number
  frequency: string
  interval_count: number | null
}
