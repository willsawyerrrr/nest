/**
 * The daily notification evaluator. One caller reaches it: a `pg_cron` schedule
 * (`20260905000000_notification_triggers.sql`) that POSTs once a day with the
 * service-role key and no user. The default JWT posture (`verify_jwt = true`)
 * has the gateway validate that key's signature before the handler runs; the
 * handler then checks the `role` claim, so only the cron — never a member's
 * JWT — starts an evaluation.
 *
 * It reads every household's plan with a service-role client (the cron caller
 * has no `auth.uid()` for the households' own RLS to match), evaluates the
 * triggers with the pure `@nest/plan` / `@nest/tax` engines, and pushes to each
 * member who has a device, has left the trigger on, and has not already been
 * told. The send paths are `_shared/webpush.ts` (installed PWAs) and
 * `_shared/apns.ts` (the native app), both shared with `push-test`. Either may be
 * unconfigured: its devices are skipped, and the run only refuses when neither
 * is.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { handlePreflight, json, requirePost } from '../_shared/http.ts'
import { loadBudgetSummaryBundle, readHouseholdTable } from '../_shared/householdBuffer.ts'
import { type ApnsSender, createApnsSender, loadApnsKeys } from '../_shared/apns.ts'
import { loadVapidKeys } from '../_shared/vapid.ts'
import { createPushSender, type PushSender } from '../_shared/webpush.ts'
import { isServiceRoleToken } from '../up-sync/auth.ts'
import {
  type AccountBalanceRow,
  type ApnsDeviceRow,
  type BudgetLineRow,
  type GiftPurchaseRow,
  type HouseholdBundle,
  type LogRow,
  type PreferenceRow,
  runNotifyEval,
  type SavingsGoalRow,
  type SubscriptionRow,
  type TemporaryItemRow,
} from './eval.ts'

/** How far back `notification_log` is read for the dedupe check. */
const LOG_LOOKBACK_DAYS = 40

/** Stands in for a sender that is not configured; its devices are never loaded. */
const unconfigured = () => Promise.resolve({ delivered: false, gone: false } as const)

/** The Web Push sender, or `null` when the VAPID keys are unset or malformed. */
async function loadWebPushSender(admin: SupabaseClient): Promise<PushSender | null> {
  const keys = await loadVapidKeys(admin)
  if (!keys) return null
  try {
    return await createPushSender(keys)
  } catch {
    return null
  }
}

/** The APNs sender, or `null` when the APNs credentials are unset or malformed. */
async function loadApnsSender(admin: SupabaseClient): Promise<ApnsSender | null> {
  const keys = await loadApnsKeys(admin)
  if (!keys) return null
  try {
    return await createApnsSender(keys)
  } catch {
    return null
  }
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request)
  if (preflight) return preflight
  const methodError = requirePost(request)
  if (methodError) return methodError

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Service-role credentials not configured' }, 500)
  }

  const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!isServiceRoleToken(bearer)) {
    return json({ error: 'Forbidden' }, 403)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const [sendPush, sendApns] = await Promise.all([loadWebPushSender(admin), loadApnsSender(admin)])
  if (!sendPush && !sendApns) {
    return json({ error: 'Push notifications are not configured.' }, 503)
  }

  const sinceIso = new Date(Date.now() - LOG_LOOKBACK_DAYS * 86_400_000).toISOString()

  const result = await runNotifyEval({
    now: () => new Date(),
    loadHouseholdIds: async () => {
      const { data, error } = await admin.from('members').select('household_id')
      if (error) throw new Error(`Failed to list households: ${error.message}`)
      return [...new Set((data ?? []).map((row) => row.household_id as string))]
    },
    loadBundle: async (householdId, financialYear): Promise<HouseholdBundle> => {
      const [base, accountBalances, giftPurchases] = await Promise.all([
        loadBudgetSummaryBundle(admin, householdId, financialYear),
        readHouseholdTable(admin, householdId, 'account_balance'),
        readHouseholdTable(admin, householdId, 'gift_purchase'),
      ])
      return {
        ...base,
        budgetLines: base.budgetLines as BudgetLineRow[],
        savingsGoals: base.savingsGoals as SavingsGoalRow[],
        temporaryItems: base.temporaryItems as TemporaryItemRow[],
        accountBalances: accountBalances as AccountBalanceRow[],
        giftPurchases: giftPurchases as GiftPurchaseRow[],
      }
    },
    loadSubscriptions: async (householdId): Promise<SubscriptionRow[]> => {
      if (!sendPush) return []
      const { data, error } = await admin
        .from('push_subscription')
        .select('id, member_id, endpoint, p256dh, auth')
        .eq('household_id', householdId)
      if (error) throw new Error(`Failed to read push_subscription: ${error.message}`)
      return (data ?? []) as SubscriptionRow[]
    },
    loadApnsDevices: async (householdId): Promise<ApnsDeviceRow[]> => {
      if (!sendApns) return []
      const { data, error } = await admin
        .from('apns_device')
        .select('id, member_id, token, environment')
        .eq('household_id', householdId)
      if (error) throw new Error(`Failed to read apns_device: ${error.message}`)
      return (data ?? []) as ApnsDeviceRow[]
    },
    loadPreferences: async (householdId): Promise<PreferenceRow[]> => {
      const { data, error } = await admin
        .from('notification_preference')
        .select('member_id, trigger, enabled')
        .eq('household_id', householdId)
      if (error) throw new Error(`Failed to read notification_preference: ${error.message}`)
      return (data ?? []) as PreferenceRow[]
    },
    loadRecentLog: async (householdId): Promise<LogRow[]> => {
      const { data, error } = await admin
        .from('notification_log')
        .select('member_id, trigger, dedupe_key, sent_at')
        .eq('household_id', householdId)
        .gte('sent_at', sinceIso)
      if (error) throw new Error(`Failed to read notification_log: ${error.message}`)
      return (data ?? []) as LogRow[]
    },
    sendPush: sendPush ?? unconfigured,
    sendApns: sendApns ?? unconfigured,
    prune: async (deviceIds) => {
      const { error } = await admin.from('push_subscription').delete().in('id', deviceIds)
      if (error) throw new Error(`Failed to prune push_subscription: ${error.message}`)
    },
    pruneApns: async (deviceIds) => {
      const { error } = await admin.from('apns_device').delete().in('id', deviceIds)
      if (error) throw new Error(`Failed to prune apns_device: ${error.message}`)
    },
    recordLog: async ({ householdId, memberId, trigger, dedupeKey }) => {
      const { error } = await admin.from('notification_log').insert({
        household_id: householdId,
        member_id: memberId,
        trigger,
        dedupe_key: dedupeKey,
      })
      if (error) throw new Error(`Failed to record notification_log: ${error.message}`)
    },
  })

  return json(result, 200)
})
