import { useCallback } from 'react'
import { useHouseholdId } from '../components/HouseholdProvider'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useHouseholdQuery } from './useCollection'

/**
 * The columns `authenticated` may read (see the migration's column-level
 * grant) — never `token_hash`, the credential itself. `select('*')` would fail
 * outright: Postgres refuses a `SELECT *` when the caller lacks privilege on
 * any expanded column.
 */
export type CalendarFeedRow = Pick<Tables<'calendar_feed'>, 'household_id' | 'created_at'>

export interface UseCalendarFeedResult {
  /** The household's live feed row, or null when none has been generated. */
  status: CalendarFeedRow | null
  loading: boolean
  reload: () => Promise<void>
  /** Mints (or replaces) the household's feed token; returns the plaintext token, shown once. */
  create: () => Promise<string>
  /** Revokes the household's feed token; a no-op when there is none. */
  revoke: () => Promise<void>
}

/**
 * Loads and manages the household's single calendar-feed token. Bespoke rather
 * than `useHouseholdCollection`: `calendar_feed` is keyed on `household_id`
 * itself (at most one row per household), not an `id` column, and every write
 * goes through `create_calendar_feed_token` / `revoke_calendar_feed_token`
 * rather than a plain insert/update/delete. The read is cached household-scoped;
 * each write invalidates the `['calendar_feed', householdId]` prefix so the
 * status refetches.
 */
export function useCalendarFeed(): UseCalendarFeedResult {
  const householdId = useHouseholdId()

  const { data, loading, reload } = useHouseholdQuery(['calendar_feed', householdId], async () => {
    const { data, error } = await supabase
      .from('calendar_feed')
      .select('household_id, created_at')
      .maybeSingle()
    if (error) {
      throw error
    }
    return data
  })

  const create = useCallback(async () => {
    const { data, error } = await supabase.rpc('create_calendar_feed_token')
    if (error) {
      throw error
    }
    await reload()
    return data as string
  }, [reload])

  const revoke = useCallback(async () => {
    const { error } = await supabase.rpc('revoke_calendar_feed_token')
    if (error) {
      throw error
    }
    await reload()
  }, [reload])

  return { status: data ?? null, loading, reload, create, revoke }
}
