import { fortnightlyCents } from '@nest/plan'
import type { Tables } from './database.types'
import { sortBy, type SortDirection } from './sort'

type BudgetLine = Tables<'budget_line'>

/** How the lines within each budget group are ordered. */
export type BudgetLineSortKey = 'default' | 'name' | 'amount'

/** The search as matched: trimmed and lower-cased, `''` when not searching. */
export function budgetLineSearch(query: string): string {
  return query.trim().toLowerCase()
}

/**
 * A group's lines as listed: those whose name contains `search` (all when it is
 * `''`), in the chosen order. `default` keeps the given order; `name` and
 * fortnightly `amount` sort ascending, reversed for descending.
 */
export function visibleBudgetLines(
  lines: BudgetLine[],
  search: string,
  key: BudgetLineSortKey,
  direction: SortDirection,
): BudgetLine[] {
  const matching = search ? lines.filter((line) => line.name.toLowerCase().includes(search)) : lines
  if (key === 'default') {
    return matching
  }
  return sortBy(
    matching,
    (a, b) =>
      key === 'name'
        ? a.name.localeCompare(b.name)
        : fortnightlyCents(a.amount_cents, a.frequency, a.interval_count ?? undefined) -
          fortnightlyCents(b.amount_cents, b.frequency, b.interval_count ?? undefined),
    direction,
  )
}
