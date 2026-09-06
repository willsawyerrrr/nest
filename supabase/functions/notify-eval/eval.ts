/**
 * The daily notification evaluator, with its I/O injected so the decision
 * logic is unit-tested without a database or a push service. `index.ts` wires
 * the real service-role reads and the shared Web Push sender.
 *
 * For each household it reconciles the plan with the pure `@nest/plan` /
 * `@nest/tax` engines, checks four conditions against today's data, and — for
 * each member who has a device, has left the trigger on, and has not already
 * been told — sends `{ title, body, url }` and records a `notification_log`
 * row. The log row is the dedupe: a `(member, trigger, dedupe_key)` already
 * present (within the trigger's re-notify window) is skipped.
 */

import { fortnightlyCents, type Frequency, projectGoal } from '@nest/plan'
import { financialYearForDate } from '@nest/tax'
import type { DeliveryOutcome, PushDevice, PushPayload } from '../_shared/webpush.ts'
import type { BudgetLineRow as BufferBudgetLineRow } from '../_shared/householdBuffer/adapters.ts'
import {
  type BudgetSummaryBundle,
  summariseHouseholdFromRows,
  type TemporaryItemRow as BufferTemporaryItemRow,
} from '../_shared/householdBuffer/summary.ts'

/** The four today's-data conditions, matching the `notification_trigger` enum. */
export type Trigger =
  | 'buffer_negative'
  | 'goal_eta_slipped'
  | 'temporary_item_expiring'
  | 'fy_boundary'

/** A day either side of `targetDate` counts as "within 14 days". */
export const EXPIRY_WINDOW_DAYS = 14

/** After this long a still-negative buffer is notified again. */
export const BUFFER_RENOTIFY_DAYS = 14

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
}

/** One opted-in device with the member it belongs to. */
export interface SubscriptionRow extends PushDevice {
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
}

export interface NotifyEvalDeps {
  now: () => Date
  /** Every household with at least one member. */
  loadHouseholdIds: () => Promise<string[]>
  loadBundle: (householdId: string, financialYear: number) => Promise<HouseholdBundle>
  loadSubscriptions: (householdId: string) => Promise<SubscriptionRow[]>
  loadPreferences: (householdId: string) => Promise<PreferenceRow[]>
  /** Recent `notification_log` rows for the household (the dedupe ledger). */
  loadRecentLog: (householdId: string) => Promise<LogRow[]>
  /** Sends one encrypted push; resolves — never throws — with the outcome. */
  sendPush: (device: PushDevice, payload: PushPayload) => Promise<DeliveryOutcome>
  /** Deletes the subscription rows a push service reported gone. */
  prune: (deviceIds: string[]) => Promise<void>
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
  /** Individual device deliveries the push service accepted. */
  sent: number
  /** Dead subscriptions removed. */
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

  return firings
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

    const subscriptions = await deps.loadSubscriptions(householdId)
    if (subscriptions.length === 0) continue
    const preferences = await deps.loadPreferences(householdId)
    const log = await deps.loadRecentLog(householdId)

    const devicesByMember = new Map<string, SubscriptionRow[]>()
    for (const subscription of subscriptions) {
      const list = devicesByMember.get(subscription.member_id) ?? []
      list.push(subscription)
      devicesByMember.set(subscription.member_id, list)
    }
    const disabled = new Set(
      preferences.filter((pref) => !pref.enabled).map((pref) =>
        `${pref.member_id}:${pref.trigger}`
      ),
    )

    const goneIds: string[] = []
    for (const firing of firings) {
      for (const [memberId, devices] of devicesByMember) {
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
          const outcome = await deps.sendPush(device, firing.payload)
          if (outcome.delivered) {
            summary.sent += 1
            delivered = true
          } else if (outcome.gone) {
            goneIds.push(device.id)
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

    if (goneIds.length > 0) {
      await deps.prune(goneIds)
      summary.pruned += goneIds.length
    }
  }

  return summary
}
