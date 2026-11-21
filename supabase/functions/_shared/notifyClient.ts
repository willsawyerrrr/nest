/**
 * The service-role I/O behind `notify.ts`'s delivery loop and the
 * transaction-review prompt, shared by `notify-eval`, `up-sync` and
 * `up-webhook`. Every read is scoped to one household.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { type ApnsSender, createApnsSender, loadApnsKeys } from './apns.ts'
import type {
  ApnsDeviceRow,
  DeliveryDeps,
  LogRow,
  PreferenceRow,
  SubscriptionRow,
} from './notify.ts'
import {
  notifyInsertedTransactions,
  type ReviewContext,
  type ReviewTransactionRow,
  type UpCategoryNameRow,
  type UpHandleRow,
} from './transactionReview.ts'
import { loadVapidKeys } from './vapid.ts'
import { createPushSender, type PushSender } from './webpush.ts'

/** How far back `notification_log` is read for the dedupe check. */
const LOG_LOOKBACK_DAYS = 40

/** The `transactions` columns the review prompt reads. */
export const REVIEW_TRANSACTION_COLUMNS =
  'id, account_id, description, amount_cents, posted_at, created_at, is_categorizable, reviewed_at, external_category, performing_customer_name'

/** The configured senders; a channel that is unset or malformed is null. */
export interface Senders {
  sendPush: PushSender | null
  sendApns: ApnsSender | null
}

/** Binds the Web Push and APNs senders from their Vault-held keys. */
export async function loadSenders(admin: SupabaseClient): Promise<Senders> {
  const [sendPush, sendApns] = await Promise.all([
    loadVapidKeys(admin).then((keys) => keys && createPushSender(keys)).catch(() => null),
    loadApnsKeys(admin).then((keys) => keys && createApnsSender(keys)).catch(() => null),
  ])
  return { sendPush, sendApns }
}

/** Stands in for a sender that is not configured; its devices are never loaded. */
const unconfigured = () => Promise.resolve({ delivered: false, gone: false } as const)

/** The delivery loop's reads and writes, on a service-role client. */
export function deliveryDeps(admin: SupabaseClient, senders: Senders): DeliveryDeps {
  const sinceIso = new Date(Date.now() - LOG_LOOKBACK_DAYS * 86_400_000).toISOString()
  return {
    loadSubscriptions: async (householdId) => {
      if (!senders.sendPush) return []
      const { data, error } = await admin
        .from('push_subscription')
        .select('id, member_id, endpoint, p256dh, auth')
        .eq('household_id', householdId)
      if (error) throw new Error(`Failed to read push_subscription: ${error.message}`)
      return (data ?? []) as SubscriptionRow[]
    },
    loadApnsDevices: async (householdId) => {
      if (!senders.sendApns) return []
      const { data, error } = await admin
        .from('apns_device')
        .select('id, member_id, token, environment')
        .eq('household_id', householdId)
      if (error) throw new Error(`Failed to read apns_device: ${error.message}`)
      return (data ?? []) as ApnsDeviceRow[]
    },
    loadPreferences: async (householdId) => {
      const { data, error } = await admin
        .from('notification_preference')
        .select('member_id, trigger, enabled')
        .eq('household_id', householdId)
      if (error) throw new Error(`Failed to read notification_preference: ${error.message}`)
      return (data ?? []) as PreferenceRow[]
    },
    loadRecentLog: async (householdId) => {
      const { data, error } = await admin
        .from('notification_log')
        .select('member_id, trigger, dedupe_key, sent_at')
        .eq('household_id', householdId)
        .gte('sent_at', sinceIso)
      if (error) throw new Error(`Failed to read notification_log: ${error.message}`)
      return (data ?? []) as LogRow[]
    },
    sendPush: senders.sendPush ?? unconfigured,
    sendApns: senders.sendApns ?? unconfigured,
    prune: async (deviceIds) => {
      const { error } = await admin.from('push_subscription').delete().in('id', deviceIds)
      if (error) throw new Error(`Failed to prune push_subscription: ${error.message}`)
    },
    pruneApns: async (deviceIds) => {
      const { error } = await admin.from('apns_device').delete().in('id', deviceIds)
      if (error) throw new Error(`Failed to prune apns_device: ${error.message}`)
    },
    // `ignoreDuplicates`: a concurrent pass (a webhook and the poll, or the
    // daily backstop) that logged the same send first is not an error.
    recordLog: async ({ householdId, memberId, trigger, dedupeKey }) => {
      const { error } = await admin.from('notification_log').upsert({
        household_id: householdId,
        member_id: memberId,
        trigger,
        dedupe_key: dedupeKey,
      }, { onConflict: 'member_id,trigger,dedupe_key', ignoreDuplicates: true })
      if (error) throw new Error(`Failed to record notification_log: ${error.message}`)
    },
  }
}

/** The Up handles each member's own individual accounts carry. */
export async function readUpHandles(
  admin: SupabaseClient,
  householdId: string,
): Promise<UpHandleRow[]> {
  const { data, error } = await admin.rpc('up_customer_handles', { p_household_id: householdId })
  if (error) throw new Error(`Failed to read Up handles: ${error.message}`)
  return (data ?? []) as UpHandleRow[]
}

/** Up's category names. */
export async function readUpCategories(admin: SupabaseClient): Promise<UpCategoryNameRow[]> {
  const { data, error } = await admin.from('up_category').select('id, name')
  if (error) throw new Error(`Failed to read up_category: ${error.message}`)
  return (data ?? []) as UpCategoryNameRow[]
}

/** Everything besides the transactions the review prompt reads for one household. */
async function readReviewContext(
  admin: SupabaseClient,
  householdId: string,
): Promise<ReviewContext> {
  const [accounts, members, handles, categories, purchases] = await Promise.all([
    admin.from('accounts').select('id, owner_member_id').eq('household_id', householdId),
    admin.from('members').select('id, name').eq('household_id', householdId),
    readUpHandles(admin, householdId),
    readUpCategories(admin),
    admin.from('gift_purchase').select('transaction_id').eq('household_id', householdId)
      .not('transaction_id', 'is', null),
  ])
  for (
    const [table, result] of [
      ['accounts', accounts],
      ['members', members],
      ['gift_purchase', purchases],
    ] as const
  ) {
    if (result.error) throw new Error(`Failed to read ${table}: ${result.error.message}`)
  }
  return {
    accounts: accounts.data ?? [],
    members: members.data ?? [],
    handles,
    categories,
    linkedTransactionIds: new Set(
      (purchases.data ?? []).map((row) => row.transaction_id as string),
    ),
  }
}

/**
 * Prompts review of the Up transactions an ingestion pass just inserted. Best
 * effort: a failure is logged, never thrown, so it costs the ingestion
 * nothing, and `notify-eval`'s daily backstop retries the delivery. Senders
 * are bound only when there is something to send.
 */
export async function promptReviewOfInserted(
  admin: SupabaseClient,
  householdId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return
  try {
    await notifyInsertedTransactions(
      {
        loadTransactions: async (household, transactionIds) => {
          const { data, error } = await admin
            .from('transactions')
            .select(REVIEW_TRANSACTION_COLUMNS)
            .eq('household_id', household)
            .eq('source', 'up')
            .in('id', transactionIds)
          if (error) throw new Error(`Failed to read transactions: ${error.message}`)
          return (data ?? []) as ReviewTransactionRow[]
        },
        loadContext: (household) => readReviewContext(admin, household),
        delivery: async () => deliveryDeps(admin, await loadSenders(admin)),
      },
      householdId,
      ids,
      new Date(),
    )
  } catch (error) {
    console.error(`Prompting review of new transactions in household ${householdId} failed:`, error)
  }
}
