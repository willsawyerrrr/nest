/**
 * The daily notification evaluator, with its I/O injected so the decision
 * logic is unit-tested without a database or a push service. `index.ts` wires
 * the real service-role reads and the shared Web Push and APNs senders.
 *
 * For each household it reconciles the plan with the pure `@nest/plan` /
 * `@nest/tax` engines, checks its conditions against today's data, and — for
 * each member who has a device (a Web Push subscription or a native APNs
 * token), has left the trigger on, and has not already
 * been told — sends `{ title, body, url }` and records a `notification_log`
 * row. The log row is the dedupe: a `(member, trigger, dedupe_key)` already
 * present (within the trigger's re-notify window) is skipped.
 */

import { fortnightlyCents, type Frequency, projectGoal } from '@nest/plan'
import { financialYearForDate } from '@nest/tax'
import {
  type BudgetLineRow as BufferBudgetLineRow,
  type BudgetSummaryBundle,
  summariseHouseholdFromRows,
  type TemporaryItemRow as BufferTemporaryItemRow,
} from '@nest/household'
import type { ApnsDevice } from '../_shared/apns.ts'
import type { DeliveryOutcome, PushDevice, PushPayload } from '../_shared/webpush.ts'

/** The today's-data conditions, matching the `notification_trigger` enum. */
export type Trigger =
  | 'buffer_negative'
  | 'goal_eta_slipped'
  | 'temporary_item_expiring'
  | 'fy_boundary'
  | 'gift_purchase_unassigned'
  | 'gift_candidate_new'
  | 'up_disconnected'

/** A day either side of `targetDate` counts as "within 14 days". */
export const EXPIRY_WINDOW_DAYS = 14

/**
 * A purchase is announced for this many days after it is created, so a run that
 * fails transiently is retried, while a long-forgotten backlog is not announced
 * all at once.
 */
export const UNASSIGNED_GIFT_WINDOW_DAYS = 7

/**
 * A gift candidate is announced for this many days after it first lands in
 * `transactions`, the same retry-without-backlog rationale as
 * {@link UNASSIGNED_GIFT_WINDOW_DAYS}.
 */
export const NEW_GIFT_CANDIDATE_WINDOW_DAYS = 7

/** After this long a still-negative buffer is notified again. */
export const BUFFER_RENOTIFY_DAYS = 14

/** The Up category `up-sync` ingests as gift candidates. */
const UP_GIFT_CATEGORY = 'gifts-and-charity'

/** The `savings_goal` columns the goal trigger reads. */
export interface SavingsGoalRow {
  id: string
  name: string
  target_amount_cents: number
  current_balance_cents: number
  target_date: string | null
  annual_interest_bps: number | null
  linked_account_id: string | null
}

/** The `budget_line` columns the goal trigger reads, on top of what the buffer needs. */
export interface BudgetLineRow extends BufferBudgetLineRow {
  goal_id: string | null
}

/** The `temporary_item` columns the expiry trigger reads, on top of what the buffer needs. */
export interface TemporaryItemRow extends BufferTemporaryItemRow {
  id: string
  name: string
}

/** The `gift_purchase` columns the unassigned-purchase and gift-candidate triggers read. */
export interface GiftPurchaseRow {
  id: string
  amount_cents: number
  description: string
  gift_budget_id: string | null
  gift_discretionary_budget_id: string | null
  transaction_id: string | null
  created_at: string
}

/** The `transactions` columns the new-gift-candidate trigger reads. */
export interface TransactionRow {
  id: string
  account_id: string
  description: string
  amount_cents: number
  external_category: string | null
  created_at: string
}

/** The `accounts` columns the new-gift-candidate trigger reads, to resolve who can see a transaction. */
export interface AccountOwnerRow {
  id: string
  owner_member_id: string | null
}

/** A `gift_transaction_dismissal` row: a candidate the household set aside as "not a gift". */
export interface GiftTransactionDismissalRow {
  transaction_id: string
}

/** The `members` columns the Up-disconnection trigger reads. */
export interface MemberConnectionRow {
  id: string
  name: string
  up_sync_failed_at: string | null
}

/** An `account_balance` row: a linked saver's synced balance overrides the goal's own. */
export interface AccountBalanceRow {
  account_id: string
  balance_cents: number
}

/** Everything one household's evaluation reads. */
export interface HouseholdBundle extends BudgetSummaryBundle {
  budgetLines: readonly BudgetLineRow[]
  savingsGoals: readonly SavingsGoalRow[]
  temporaryItems: readonly TemporaryItemRow[]
  accountBalances: readonly AccountBalanceRow[]
  giftPurchases: readonly GiftPurchaseRow[]
  transactions: readonly TransactionRow[]
  accounts: readonly AccountOwnerRow[]
  giftTransactionDismissals: readonly GiftTransactionDismissalRow[]
  /**
   * The same `members` table's Up-connection columns, distinct from
   * {@link BudgetSummaryBundle}'s own `members` (id and date of birth only).
   */
  memberConnections: readonly MemberConnectionRow[]
}

/** One opted-in device with the member it belongs to. */
export interface SubscriptionRow extends PushDevice {
  member_id: string
}

/** One native install with the member it belongs to. */
export interface ApnsDeviceRow extends ApnsDevice {
  member_id: string
}

/** A member's on/off choice for one trigger; an absent row means on. */
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
   * Restricts the firing to one member — e.g. a gift candidate on an
   * individually-owned account, which only its owner can see. Undefined means
   * every member with a device may be told, as the rest of the triggers are:
   * household-wide facts with no single owner.
   */
  visibleToMemberId?: string
}

export interface NotifyEvalDeps {
  now: () => Date
  /** Every household with at least one member. */
  loadHouseholdIds: () => Promise<string[]>
  loadBundle: (householdId: string, financialYear: number) => Promise<HouseholdBundle>
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

/** What the run reports, so a cron log line says what it did. */
export interface NotifyEvalSummary {
  households: number
  /** Distinct (household, trigger) conditions that fired. */
  firings: number
  /** (member, trigger) notifications recorded this run. */
  notified: number
  /** Individual device deliveries a push service (Web Push or APNs) accepted. */
  sent: number
  /** Dead subscriptions and APNs devices removed. */
  pruned: number
  /** (member, trigger) pairs skipped: trigger off or already sent. */
  skipped: number
  /** Device deliveries that failed transiently (retried next run). */
  failed: number
}

/** `$1,234.56` from an integer-cents figure. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  const centsPart = String(abs % 100).padStart(2, '0')
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-AU')}.${centsPart}`
}

/** Whole days from `now`'s calendar date to the ISO date `iso`, both at UTC midnight. */
export function daysUntil(now: Date, iso: string): number {
  const target = Date.parse(`${iso}T00:00:00Z`)
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((target - today) / 86_400_000)
}

/** The next 30 June on or after `now` (ISO). */
export function upcomingJune30(now: Date): string {
  const year = now.getUTCFullYear()
  const thisYear = `${year}-06-30`
  return daysUntil(now, thisYear) >= 0 ? thisYear : `${year + 1}-06-30`
}

/**
 * The household's fortnightly buffer — the PWA Summary's on-screen "fortnightly
 * after saving" figure, computed by the one shared server-side implementation.
 */
function bufferFortnightlyCents(bundle: HouseholdBundle, now: Date): number {
  return summariseHouseholdFromRows(bundle, now).afterSaving.fortnightlyCents
}

/** A dated goal whose projected completion is past its target (or unreachable). */
function goalSlipped(
  goal: SavingsGoalRow,
  bundle: HouseholdBundle,
  now: Date,
): boolean {
  if (goal.target_date == null) return false
  const contributionCents = bundle.budgetLines
    .filter((line) => line.goal_id === goal.id)
    .reduce(
      (total, line) =>
        total +
        fortnightlyCents(
          line.amount_cents,
          line.frequency as Frequency,
          line.interval_count ?? undefined,
        ),
      0,
    )
  const balanceByAccount = new Map(
    bundle.accountBalances.map((row) => [row.account_id, row.balance_cents]),
  )
  const currentBalanceCents = goal.linked_account_id != null
    ? balanceByAccount.get(goal.linked_account_id) ?? goal.current_balance_cents
    : goal.current_balance_cents
  const projection = projectGoal(
    {
      targetAmountCents: goal.target_amount_cents,
      currentBalanceCents,
      targetDate: goal.target_date,
      annualInterestBps: goal.annual_interest_bps,
    },
    contributionCents,
    now,
  )
  if (projection.alreadyMet) return false
  return (
    projection.projectedCompletionDate === null ||
    projection.projectedCompletionDate > goal.target_date
  )
}

/**
 * The triggers that fire for a household at `now`. Pure — the same rows in
 * always give the same firings out.
 */
export function evaluateHousehold(bundle: HouseholdBundle, now: Date): Firing[] {
  const firings: Firing[] = []
  const financialYear = financialYearForDate(now)

  const buffer = bufferFortnightlyCents(bundle, now)
  if (buffer < 0) {
    firings.push({
      trigger: 'buffer_negative',
      dedupeKey: String(financialYear),
      payload: {
        title: 'Your fortnightly buffer has gone negative',
        body: `This fortnight's plan is ${formatCents(-buffer)} short of what comes in.`,
        url: '/summary',
      },
    })
  }

  for (const goal of bundle.savingsGoals) {
    if (goalSlipped(goal, bundle, now)) {
      firings.push({
        trigger: 'goal_eta_slipped',
        dedupeKey: `${goal.id}:${goal.target_date}`,
        payload: {
          title: 'A savings goal is running late',
          body:
            `"${goal.name}" is not on track to reach its target by ${goal.target_date} at the current contribution.`,
          url: '/goals',
        },
      })
    }
  }

  for (const item of bundle.temporaryItems) {
    const days = daysUntil(now, item.target_date)
    if (days >= 0 && days <= EXPIRY_WINDOW_DAYS) {
      firings.push({
        trigger: 'temporary_item_expiring',
        dedupeKey: item.id,
        payload: {
          title: 'A temporary budget item is ending soon',
          body: `"${item.name}" is set to end on ${item.target_date}.`,
          url: '/budget',
        },
      })
    }
  }

  const daysToJune30 = daysUntil(now, upcomingJune30(now))
  if (daysToJune30 >= 0 && daysToJune30 <= EXPIRY_WINDOW_DAYS) {
    firings.push({
      trigger: 'fy_boundary',
      dedupeKey: String(financialYear),
      payload: {
        title: 'End of the financial year is near',
        body: 'Check your tax settings and deductions before 30 June.',
        url: '/tax',
      },
    })
  }

  for (const purchase of bundle.giftPurchases) {
    if (!isRecentUnassignedGiftPurchase(purchase, now)) continue
    const label = purchase.description.trim()
    firings.push({
      trigger: 'gift_purchase_unassigned',
      dedupeKey: purchase.id,
      payload: {
        title: 'Assign your gift purchase',
        body: `${label === '' ? 'A gift purchase' : `"${label}"`} (${
          formatCents(purchase.amount_cents)
        }) has no recipient or occasion yet.`,
        url: '/gifts',
      },
    })
  }

  const linkedTransactionIds = new Set(
    bundle.giftPurchases
      .map((purchase) => purchase.transaction_id)
      .filter((id): id is string => id != null),
  )
  const dismissedTransactionIds = new Set(
    bundle.giftTransactionDismissals.map((dismissal) => dismissal.transaction_id),
  )
  const ownerMemberIdByAccount = new Map(
    bundle.accounts.map((account) => [account.id, account.owner_member_id]),
  )
  for (const transaction of bundle.transactions) {
    if (!isNewGiftCandidate(transaction, linkedTransactionIds, dismissedTransactionIds, now)) {
      continue
    }
    const label = transaction.description.trim()
    const ownerMemberId = ownerMemberIdByAccount.get(transaction.account_id)
    firings.push({
      trigger: 'gift_candidate_new',
      dedupeKey: transaction.id,
      visibleToMemberId: ownerMemberId ?? undefined,
      payload: {
        title: 'A new gift candidate arrived',
        body: `${label === '' ? 'A transaction' : `"${label}"`} (${
          formatCents(Math.abs(transaction.amount_cents))
        }) was synced from your card as Gifts and Charity.`,
        url: '/gifts',
      },
    })
  }

  for (const memberRow of bundle.memberConnections) {
    if (memberRow.up_sync_failed_at == null) continue
    firings.push({
      trigger: 'up_disconnected',
      // Includes the failure timestamp, not just the member id: reconnecting
      // and failing again later is a fresh occurrence, which a dedupe key
      // scoped to the member alone would never re-fire for.
      dedupeKey: `${memberRow.id}:${memberRow.up_sync_failed_at}`,
      payload: {
        title: 'Your Up connection needs reconnecting',
        body:
          `${memberRow.name}'s Up personal access token was rejected — reconnect it in Connections to keep syncing.`,
        url: '/settings/connections',
      },
    })
  }

  return firings
}

/** A purchase counting against neither a gift budget nor the discretionary buffer, created within the window. */
function isRecentUnassignedGiftPurchase(purchase: GiftPurchaseRow, now: Date): boolean {
  if (purchase.gift_budget_id != null || purchase.gift_discretionary_budget_id != null) {
    return false
  }
  const ageMs = now.getTime() - Date.parse(purchase.created_at)
  return ageMs <= UNASSIGNED_GIFT_WINDOW_DAYS * 86_400_000
}

/**
 * A synced transaction that is still an unclaimed gift candidate — Up filed it
 * under the gift category, no purchase has linked it, and the household has
 * not dismissed it as "not a gift" — created within the window.
 *
 * `created_at` is the row's first-insert time: `sync_up_gift_transactions`'s
 * upsert never touches it on a later rescan, so it marks when the candidate
 * actually arrived, not when it was last reconfirmed in the category.
 */
function isNewGiftCandidate(
  transaction: TransactionRow,
  linkedTransactionIds: ReadonlySet<string>,
  dismissedTransactionIds: ReadonlySet<string>,
  now: Date,
): boolean {
  if (transaction.external_category !== UP_GIFT_CATEGORY) return false
  if (linkedTransactionIds.has(transaction.id)) return false
  if (dismissedTransactionIds.has(transaction.id)) return false
  const ageMs = now.getTime() - Date.parse(transaction.created_at)
  return ageMs <= NEW_GIFT_CANDIDATE_WINDOW_DAYS * 86_400_000
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
  // new financial year each make a fresh key).
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

/** Runs the evaluation across every household. */
export async function runNotifyEval(deps: NotifyEvalDeps): Promise<NotifyEvalSummary> {
  const now = deps.now()
  const financialYear = financialYearForDate(now)
  const summary: NotifyEvalSummary = {
    households: 0,
    firings: 0,
    notified: 0,
    sent: 0,
    pruned: 0,
    skipped: 0,
    failed: 0,
  }

  for (const householdId of await deps.loadHouseholdIds()) {
    summary.households += 1
    const bundle = await deps.loadBundle(householdId, financialYear)
    const firings = evaluateHousehold(bundle, now)
    if (firings.length === 0) continue
    summary.firings += firings.length

    const [subscriptions, apnsDevices] = await Promise.all([
      deps.loadSubscriptions(householdId),
      deps.loadApnsDevices(householdId),
    ])
    if (subscriptions.length === 0 && apnsDevices.length === 0) continue
    const preferences = await deps.loadPreferences(householdId)
    const log = await deps.loadRecentLog(householdId)

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
    const disabled = new Set(
      preferences.filter((pref) => !pref.enabled).map((pref) =>
        `${pref.member_id}:${pref.trigger}`
      ),
    )

    const gone: Record<Target['kind'], string[]> = { web: [], apns: [] }
    for (const firing of firings) {
      for (const [memberId, devices] of devicesByMember) {
        if (firing.visibleToMemberId != null && firing.visibleToMemberId !== memberId) {
          continue
        }
        if (disabled.has(`${memberId}:${firing.trigger}`)) {
          summary.skipped += 1
          continue
        }
        if (alreadySent(log, memberId, firing, now)) {
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

        // Log only once a device took it, so a run where every endpoint failed
        // transiently is retried tomorrow rather than silently deduped away.
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
  }

  return summary
}
