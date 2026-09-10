/**
 * The `budget-line` flow with its I/O injected, so the shape — resolve the
 * caller's household, load its budget lines, match one by name — is unit-tested
 * without a database. `index.ts` wires the real service-role reads.
 *
 * It answers "how much is budgeted for groceries": the matched line's amount in
 * its own cadence, plus the fortnightly and annual normalisations from the
 * shared `@nest/plan` helpers, and every line name so a miss can say what
 * exists.
 */

import { annualCents, fortnightlyCents, type Frequency } from '@nest/plan'
import type { CallerError } from '../_shared/caller.ts'

/** The `budget_line` columns this reads. A derived line (breakdown, gift) carries a stored `amount_cents` from the reconcile, so it is read like any other. */
export interface BudgetLineRow {
  name: string
  amount_cents: number
  frequency: Frequency
  interval_count: number | null
}

/** The matched budget line in the response. */
export interface BudgetLineMatch {
  name: string
  amountCents: number
  frequency: Frequency
  intervalCount: number | null
  fortnightlyCents: number
  annualCents: number
}

/** The `budget-line` response body. */
export interface BudgetLineBody {
  /** The best name match, or `null` when nothing matched. */
  match: BudgetLineMatch | null
  /** Every budget line name, sorted, so a null match can say what exists. */
  names: string[]
}

/** Lower-cases, collapses runs of whitespace, and trims — the form both a query and a line name are compared in. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Picks the budget line whose name best matches `query`: an exact (normalised)
 * match wins; otherwise the shortest name that contains the query or is
 * contained by it, so "groceries" matches "Groceries" and "rent" matches
 * "Rent & rates". An empty query, or a household with no lines, matches nothing.
 */
export function matchBudgetLine(
  lines: readonly BudgetLineRow[],
  query: string,
): BudgetLineRow | null {
  const wanted = normalise(query)
  if (wanted === '') {
    return null
  }

  const exact = lines.find((line) => normalise(line.name) === wanted)
  if (exact) {
    return exact
  }

  const overlapping = lines
    .filter((line) => {
      const name = normalise(line.name)
      return name !== '' && (name.includes(wanted) || wanted.includes(name))
    })
    .sort((a, b) => a.name.length - b.name.length)
  return overlapping[0] ?? null
}

/** Shapes the matched line — with its fortnightly and annual normalisations — and the sorted name list. */
export function shapeBudgetLine(lines: readonly BudgetLineRow[], query: string): BudgetLineBody {
  const names = lines.map((line) => line.name).sort((a, b) => a.localeCompare(b))
  const line = matchBudgetLine(lines, query)
  if (!line) {
    return { match: null, names }
  }

  const interval = line.interval_count ?? undefined
  return {
    match: {
      name: line.name,
      amountCents: line.amount_cents,
      frequency: line.frequency,
      intervalCount: line.interval_count,
      fortnightlyCents: fortnightlyCents(line.amount_cents, line.frequency, interval),
      annualCents: annualCents(line.amount_cents, line.frequency, interval),
    },
    names,
  }
}

export interface BudgetLineDeps {
  /** Resolves the caller's household from their JWT, or the error to return. */
  resolveHousehold: () => Promise<{ householdId: string } | { error: CallerError }>
  /** Loads the household's budget lines. */
  loadBudgetLines: (householdId: string) => Promise<readonly BudgetLineRow[]>
  /** The spoken name to match, as sent in the request body. */
  query: string
}

export interface BudgetLineResult {
  status: number
  body: unknown
}

export async function runBudgetLine(deps: BudgetLineDeps): Promise<BudgetLineResult> {
  const resolved = await deps.resolveHousehold()
  if ('error' in resolved) {
    return { status: resolved.error.status, body: { error: resolved.error.message } }
  }
  const lines = await deps.loadBudgetLines(resolved.householdId)
  return { status: 200, body: shapeBudgetLine(lines, deps.query) }
}
