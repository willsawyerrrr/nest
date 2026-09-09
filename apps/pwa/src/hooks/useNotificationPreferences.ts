import { useCallback } from 'react'
import type { Enums, Tables } from '../lib/database.types'
import { useHouseholdUpsertCollection } from './useCollection'

export type NotificationTrigger = Enums<'notification_trigger'>
export type NotificationPreference = Tables<'notification_preference'>

/** The four triggers, in the order the settings list shows them. */
export const NOTIFICATION_TRIGGERS: readonly NotificationTrigger[] = [
  'buffer_negative',
  'goal_eta_slipped',
  'temporary_item_expiring',
  'fy_boundary',
]

interface PreferenceUpsert {
  member_id: string
  trigger: NotificationTrigger
  enabled: boolean
}

export interface UseNotificationPreferencesResult {
  loading: boolean
  /** Whether a trigger is on for the signed-in member — true when no row exists yet. */
  enabled: (trigger: NotificationTrigger) => boolean
  /** Turns a trigger on or off for the signed-in member (upserts its row). */
  setEnabled: (trigger: NotificationTrigger, next: boolean) => Promise<void>
}

/**
 * The signed-in member's notification on/off choices. RLS scopes
 * `notification_preference` to the member, so a household read returns only
 * their own rows; an absent row means the trigger is on, matching the
 * evaluator's default. `memberId` is null until the members load resolves,
 * which only blocks writing.
 */
export function useNotificationPreferences(
  memberId: string | null,
): UseNotificationPreferencesResult {
  const { rows, loading, upsert } = useHouseholdUpsertCollection<
    'notification_preference',
    PreferenceUpsert
  >({ table: 'notification_preference', onConflict: 'member_id,trigger' })

  const enabled = useCallback(
    (trigger: NotificationTrigger) => rows?.find((row) => row.trigger === trigger)?.enabled ?? true,
    [rows],
  )

  const setEnabled = useCallback(
    async (trigger: NotificationTrigger, next: boolean) => {
      if (memberId === null) {
        throw new Error('The signed-in user has no member row to set a preference against')
      }
      await upsert({ member_id: memberId, trigger, enabled: next })
    },
    [memberId, upsert],
  )

  return { loading, enabled, setEnabled }
}
