import { useCallback } from 'react'
import type { Enums, Tables } from '../lib/database.types'
import type { BudgetGroup } from '../lib/domain'
import type { BreakdownItem } from './useBreakdownItems'
import { useHouseholdCollection } from './useCollection'

export type Breakdown = Tables<'breakdown'>
export type BreakdownKind = Enums<'breakdown_kind'>

/** The fields creating a breakdown supplies; identifiers and household are set by the hook. */
export interface BreakdownInput {
  name: string
  line_group: BudgetGroup
  kind: BreakdownKind
}

/** The mutable fields of a breakdown: its rolled-up line's name and group. */
export interface BreakdownUpdate {
  name: string
  line_group: BudgetGroup
}

export interface UseBreakdownsResult {
  breakdowns: Breakdown[] | null
  /** Every generic breakdown item across the household, for roll-up totals and lifecycle counts. */
  items: BreakdownItem[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: BreakdownInput) => Promise<void>
  update: (id: string, input: BreakdownUpdate) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's breakdowns, alongside every generic
 * breakdown item so a caller can roll up each breakdown's total and count its
 * items. RLS scopes reads to the household. Creating or updating a breakdown
 * leaves its items untouched, so each refreshes only the breakdown table;
 * deleting one cascades to its items in the database, so the delete refreshes
 * the items too. A breakdown write drives the `budget_line` reconcile trigger
 * (name and group flow onto the derived line, a delete cascades the line away),
 * so it invalidates `budget_line` too, keeping the raw-line consumers (the Pay
 * splits tab) current.
 */
export function useBreakdowns(): UseBreakdownsResult {
  const {
    rows: breakdownRows,
    reload: reloadBreakdowns,
    create,
    update,
    remove: removeBreakdown,
  } = useHouseholdCollection<'breakdown', BreakdownInput, BreakdownUpdate>({
    table: 'breakdown',
    orderBy: 'name',
    alsoInvalidate: ['budget_line'],
  })
  const { rows: itemRows, reload: reloadItems } = useHouseholdCollection<'breakdown_item', never>({
    table: 'breakdown_item',
    orderBy: 'name',
  })

  const reload = useCallback(async () => {
    await Promise.all([reloadBreakdowns(), reloadItems()])
  }, [reloadBreakdowns, reloadItems])

  const remove = useCallback(
    async (id: string) => {
      await removeBreakdown(id)
      await reloadItems()
    },
    [removeBreakdown, reloadItems],
  )

  return {
    breakdowns: breakdownRows,
    items: itemRows,
    loading: breakdownRows === null || itemRows === null,
    reload,
    create,
    update,
    remove,
  }
}
