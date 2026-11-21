/**
 * The notification delivery loop every server-side notifier shares: given a
 * household's firings, it pushes each to every member who may see it, has a
 * device (a Web Push subscription or a native APNs token), has the trigger on,
 * and has not already been told; logs each `(member, trigger, dedupe_key)` a
 * device took; and prunes the devices a push service reported dead. Its I/O is
 * injected so the loop is unit-tested without a database or a push service;
 * `notifyClient.ts` wires the real service-role reads and senders.
 *
 * `notify-eval` delivers its daily firings through it, and `up-sync` and
 * `up-webhook` deliver the transaction-review prompt for the rows they insert.
 */

import type { ApnsDevice } from './apns.ts'
import type { DeliveryOutcome, PushDevice, PushPayload } from './webpush.ts'

/** The `notification_trigger` enum. */
export type Trigger =
  | 'buffer_negative'
  | 'goal_eta_slipped'
  | 'temporary_item_expiring'
  | 'fy_boundary'
  | 'gift_purchase_unassigned'
  | 'gift_candidate_new'
  | 'up_disconnected'
  | 'transaction_review'

/**
 * Whether a trigger is on for a member with no `notification_preference` row.
 * Every trigger is on by default except `transaction_review`, a prompt per
 * transaction that a member opts in to.
 */
export const DEFAULT_ENABLED: Readonly<Record<Trigger, boolean>> = {
  buffer_negative: true,
  goal_eta_slipped: true,
  temporary_item_expiring: true,
  fy_boundary: true,
  gift_purchase_unassigned: true,
  gift_candidate_new: true,
  up_disconnected: true,
  transaction_review: false,
}

/** After this long a still-negative buffer is notified again. */
export const BUFFER_RENOTIFY_DAYS = 14

/** One opted-in device with the member it belongs to. */
export interface SubscriptionRow extends PushDevice {
  member_id: string
}

/** One native install with the member it belongs to. */
export interface ApnsDeviceRow extends ApnsDevice {
  member_id: string
}

/** A member's on/off choice for one trigger; an absent row means {@link DEFAULT_ENABLED}. */
export interface PreferenceRow {
  member_id: string
  trigger: Trigger
  enabled: boolean
}

/** A past send, for the dedupe check. */
export interface LogRow {
  member_id: string
  trigger: Trigger
  dedupe_key: string
  sent_at: string
}

/** A trigger that fired for a household, with the notification it produces. */
export interface Firing {
  trigger: Trigger
  dedupeKey: string
  payload: PushPayload
  /**
   * Restricts the firing to one member — e.g. a transaction on an
   * individually-owned account, which only its owner can see. Undefined means
   * every member with a device may be told: a household-wide fact with no
   * single owner.
   */
  visibleToMemberId?: string
}

export interface DeliveryDeps {
  loadSubscriptions: (householdId: string) => Promise<SubscriptionRow[]>
  loadApnsDevices: (householdId: string) => Promise<ApnsDeviceRow[]>
  loadPreferences: (householdId: string) => Promise<PreferenceRow[]>
  /** Recent `notification_log` rows for the household (the dedupe ledger). */
  loadRecentLog: (householdId: string) => Promise<LogRow[]>
  /** Sends one encrypted push; resolves — never throws — with the outcome. */
  sendPush: (device: PushDevice, payload: PushPayload) => Promise<DeliveryOutcome>
  /** Sends one APNs notification; resolves — never throws — with the outcome. */
  sendApns: (device: ApnsDevice, payload: PushPayload) => Promise<DeliveryOutcome>
  /** Deletes the subscription rows a push service reported gone. */
  prune: (deviceIds: string[]) => Promise<void>
  /** Deletes the APNs device rows APNs reported dead. */
  pruneApns: (deviceIds: string[]) => Promise<void>
  recordLog: (
    row: { householdId: string; memberId: string; trigger: Trigger; dedupeKey: string },
  ) => Promise<void>
}

/** What one delivery pass did. */
export interface DeliverySummary {
  /** (member, firing) notifications recorded. */
  notified: number
  /** Individual device deliveries a push service (Web Push or APNs) accepted. */
  sent: number
  /** Dead subscriptions and APNs devices removed. */
  pruned: number
  /** (member, firing) pairs skipped: trigger off or already sent. */
  skipped: number
  /** Device deliveries that failed transiently (retried by a later pass). */
  failed: number
}

/** A summary with every count at zero. */
export function emptyDeliverySummary(): DeliverySummary {
  return { notified: 0, sent: 0, pruned: 0, skipped: 0, failed: 0 }
}

/** Adds `more`'s counts onto `into`. */
export function addDeliverySummary(into: DeliverySummary, more: DeliverySummary): void {
  into.notified += more.notified
  into.sent += more.sent
  into.pruned += more.pruned
  into.skipped += more.skipped
  into.failed += more.failed
}

/** `$1,234.56` from an integer-cents figure. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const centsPart = String(abs % 100).padStart(2, '0')
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-AU')}.${centsPart}`
}

/** Whether a `(member, trigger, dedupeKey)` was already sent inside its window. */
function alreadySent(log: readonly LogRow[], memberId: string, firing: Firing, now: Date): boolean {
  const matches = log.filter(
    (row) =>
      row.member_id === memberId &&
      row.trigger === firing.trigger &&
      row.dedupe_key === firing.dedupeKey,
  )
  if (matches.length === 0) return false
  // A still-negative buffer is worth another nudge after two weeks; every other
  // trigger's key is meant to fire once (a new goal target date, a new item, a
  // new transaction each make a fresh key).
  if (firing.trigger !== 'buffer_negative') return true
  const cutoff = now.getTime() - BUFFER_RENOTIFY_DAYS * 86_400_000
  return matches.some((row) => Date.parse(row.sent_at) >= cutoff)
}

/** One device to attempt for a member, whichever service delivers to it. */
interface Target {
  kind: 'web' | 'apns'
  id: string
  send: (payload: PushPayload) => Promise<DeliveryOutcome>
}

/**
 * Delivers one household's firings. A log row is written only once a device
 * took the push, so a pass where every device failed transiently is retried
 * by the next rather than deduped away. Devices are loaded only when there is
 * a firing, and preferences and the log only when there is a device.
 */
export async function deliverFirings(
  deps: DeliveryDeps,
  householdId: string,
  firings: readonly Firing[],
  now: Date,
): Promise<DeliverySummary> {
  const summary = emptyDeliverySummary()
  if (firings.length === 0) return summary

  const [subscriptions, apnsDevices] = await Promise.all([
    deps.loadSubscriptions(householdId),
    deps.loadApnsDevices(householdId),
  ])
  if (subscriptions.length === 0 && apnsDevices.length === 0) return summary
  const [preferences, log] = await Promise.all([
    deps.loadPreferences(householdId),
    deps.loadRecentLog(householdId),
  ])

  const devicesByMember = new Map<string, Target[]>()
  const addTarget = (memberId: string, target: Target) => {
    const list = devicesByMember.get(memberId) ?? []
    list.push(target)
    devicesByMember.set(memberId, list)
  }
  for (const subscription of subscriptions) {
    addTarget(subscription.member_id, {
      kind: 'web',
      id: subscription.id,
      send: (payload) => deps.sendPush(subscription, payload),
    })
  }
  for (const device of apnsDevices) {
    addTarget(device.member_id, {
      kind: 'apns',
      id: device.id,
      send: (payload) => deps.sendApns(device, payload),
    })
  }
  const choices = new Map(
    preferences.map((pref) => [`${pref.member_id}:${pref.trigger}`, pref.enabled]),
  )
  const isEnabled = (memberId: string, trigger: Trigger) =>
    choices.get(`${memberId}:${trigger}`) ?? DEFAULT_ENABLED[trigger]

  const gone: Record<Target['kind'], string[]> = { web: [], apns: [] }
  for (const firing of firings) {
    for (const [memberId, devices] of devicesByMember) {
      if (firing.visibleToMemberId != null && firing.visibleToMemberId !== memberId) continue
      if (!isEnabled(memberId, firing.trigger) || alreadySent(log, memberId, firing, now)) {
        summary.skipped += 1
        continue
      }

      let delivered = false
      for (const device of devices) {
        const outcome = await device.send(firing.payload)
        if (outcome.delivered) {
          summary.sent += 1
          delivered = true
        } else if (outcome.gone) {
          gone[device.kind].push(device.id)
        } else {
          summary.failed += 1
        }
      }

      if (delivered) {
        await deps.recordLog({
          householdId,
          memberId,
          trigger: firing.trigger,
          dedupeKey: firing.dedupeKey,
        })
        summary.notified += 1
      }
    }
  }

  if (gone.web.length > 0) {
    await deps.prune(gone.web)
    summary.pruned += gone.web.length
  }
  if (gone.apns.length > 0) {
    await deps.pruneApns(gone.apns)
    summary.pruned += gone.apns.length
  }
  return summary
}
