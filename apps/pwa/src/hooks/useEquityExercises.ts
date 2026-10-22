import type { Tables } from '../lib/database.types'
import { useHouseholdCollection } from './useCollection'

export type EquityExerciseRow = Tables<'equity_exercise'>

/**
 * The exercise fields a form supplies; the household is set by the hook. The
 * strike is the grant's, snapshotted into the exercise so a later strike edit
 * cannot move it.
 */
export interface EquityExerciseInput {
  member_id: string
  grant_id: string
  exercised_on: string
  quantity: number
  strike_price_cents: number
  market_price_per_share_cents: number | null
}

export interface UseEquityExercisesResult {
  exercises: EquityExerciseRow[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: EquityExerciseInput) => Promise<void>
  update: (id: string, input: EquityExerciseInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Loads and mutates the household's equity option exercises, oldest first. Every
 * grant's exercises load together: a sale's cost base and the net capital gain
 * read them across years. RLS scopes reads to the household.
 */
export function useEquityExercises(): UseEquityExercisesResult {
  const { rows, loading, reload, create, update, remove } = useHouseholdCollection<
    'equity_exercise',
    EquityExerciseInput
  >({ table: 'equity_exercise', orderBy: ['exercised_on', 'created_at'] })
  return { exercises: rows, loading, reload, create, update, remove }
}
