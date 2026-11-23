import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { BudgetGroup } from '../lib/domain'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

/** An Up child category and the budget group its spend counts toward. */
export interface CategoryGroup {
  id: string
  name: string
  /** The parent category's name. */
  parentName: string
  /** The shared default's group; null counts it toward no group. */
  defaultGroup: BudgetGroup | null
  /** The household's override: undefined where it keeps the default, null for no group. */
  override: BudgetGroup | null | undefined
}

/** The Up category → budget group map, and its editing surface. */
export interface CategoryGroups {
  /** Every Up child category, ordered by parent then name; null while loading. */
  categories: CategoryGroup[] | null
  /** Counts `categoryId` toward `group`, or toward no group when null. */
  setGroup: (categoryId: string, group: BudgetGroup | null) => Promise<void>
  /** Restores `categoryId` to the shared default. */
  resetGroup: (categoryId: string) => Promise<void>
}

/**
 * The household's Up category → budget group map: each child category with its
 * shared default and the household's override. Keyed under `up_category_group`;
 * a write invalidates it and `budget_actual_spend`, so the Budget tab's actuals
 * regroup.
 */
export function useCategoryGroups(): CategoryGroups {
  const householdId = useHouseholdId()
  const queryClient = useQueryClient()

  const query = useHouseholdQuery(['up_category_group', householdId], async () => {
    const [categories, defaults, overrides] = await Promise.all([
      supabase.from('up_category').select('id,name,parent_id'),
      supabase.from('up_category_default_group').select('category_id,line_group'),
      supabase.from('up_category_group').select('category_id,line_group'),
    ])
    const error = categories.error ?? defaults.error ?? overrides.error
    if (error) {
      throw error
    }
    const names = new Map(categories.data.map((category) => [category.id, category.name]))
    const defaultGroups = new Map(defaults.data.map((row) => [row.category_id, row.line_group]))
    const overrideGroups = new Map(overrides.data.map((row) => [row.category_id, row.line_group]))
    return categories.data
      .filter((category) => category.parent_id !== null)
      .map((category): CategoryGroup => ({
        id: category.id,
        name: category.name,
        parentName: names.get(category.parent_id as string) ?? '',
        defaultGroup: defaultGroups.get(category.id) ?? null,
        override: overrideGroups.has(category.id) ? overrideGroups.get(category.id) : undefined,
      }))
      .sort((a, b) => a.parentName.localeCompare(b.parentName) || a.name.localeCompare(b.name))
  })

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['up_category_group', householdId] }),
      queryClient.invalidateQueries({ queryKey: ['budget_actual_spend', householdId] }),
    ])
  }, [queryClient, householdId])

  const setGroup = useCallback(
    async (categoryId: string, group: BudgetGroup | null) => {
      const { error } = await supabase
        .from('up_category_group')
        .upsert(
          { household_id: householdId, category_id: categoryId, line_group: group },
          { onConflict: 'household_id,category_id' },
        )
      if (error) {
        throw error
      }
      await refresh()
    },
    [householdId, refresh],
  )

  const resetGroup = useCallback(
    async (categoryId: string) => {
      const { error } = await supabase
        .from('up_category_group')
        .delete()
        .eq('household_id', householdId)
        .eq('category_id', categoryId)
      if (error) {
        throw error
      }
      await refresh()
    },
    [householdId, refresh],
  )

  return { categories: query.data ?? null, setGroup, resetGroup }
}
