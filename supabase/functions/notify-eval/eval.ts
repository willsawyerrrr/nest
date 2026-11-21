/**
 * The daily notification evaluator, with its I/O injected so the decision
 * logic is unit-tested without a database or a push service. `index.ts` wires
 * the real service-role reads and the shared Web Push and APNs senders.
 *
 * For each household it reconciles the plan with the pure `@nest/plan` /
 * `@nest/tax` engines, checks its conditions against today's data, and hands
 * the firings to the shared delivery loop (`_shared/notify.ts`), which pushes
 * to each member who may see one, has a device, has the trigger on, and has
 * not already been told, logging each send as its dedupe.
 */

import { fortnightlyCents, type Frequency, projectGoal } from '@nest/plan'
import { financialYearForDate } from '@nest/tax'
import {
  type BudgetLineRow as BufferBudgetLineRow,
  type BudgetSummaryBundle,
  summariseHouseholdFromRows,
  type TemporaryItemRow as BufferTemporaryItemRow,
} from '@nest/household'
import {
  addDeliverySummary,
  deliverFirings,
  type DeliveryDeps,
  type DeliverySummary,
  emptyDeliverySummary,
  type Firing,
  formatCents,
} from '../_shared/notify.ts'
import {
  reviewFirings,
  type ReviewTransactionRow,
  type UpCategoryNameRow,
  type UpHandleRow,
} from '../_shared/transactionReview.ts'

export type {
  ApnsDeviceRow,
  Firing,
  LogRow,
  PreferenceRow,
  SubscriptionRow,
  Trigger,
} from '../_shared/notify.ts'

/** A day either side of `targetDate` counts as "within 14 days". */
export const EXPIRY_WINDOW_DAYS = 14

/**
 * A purchase is announced for this many days after it is created, so a run that
 * fails transiently is retried, while a long-forgotten backlog is not announced
 * all at once.
 */
export const UNASSIGNED_GIFT_WINDOW_DAYS = 7

/**
 * A gift candidate is announced for this many days after the sync first sees it
 * in the gift category, the same retry-without-backlog rationale as
 * {@link UNASSIGNED_GIFT_WINDOW_DAYS}.
 */
export const NEW_GIFT_CANDIDATE_WINDOW_DAYS = 7

/**
 * Only a purchase posted within this many days is announced as a candidate,
 * matching the window `up-sync` rescans the gift category over, so history the
 * ledger backfills in the gift category is never announced as new.
 */
export const GIFT_CANDIDATE_MAX_AGE_DAYS = 365

/** The Up category `up-sync` ingests as gift candidates. */
export const UP_GIFT_CATEGORY = 'gifts-and-charity'

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
  external_category_since: string
  posted_at: string
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
  /** Categorisable, unreviewed Up transactions first seen within the review backstop window. */
  reviewTransactions: readonly ReviewTransactionRow[]
  /** The Up handles each member's own individual accounts carry. */
  upHandles: readonly UpHandleRow[]
  upCategories: readonly UpCategoryNameRow[]
}

export interface NotifyEvalDeps extends DeliveryDeps {
  now: () => Date
  /** Every household with at least one member. */
  loadHouseholdIds: () => Promise<string[]>
  loadBundle: (householdId: string, financialYear: number) => Promise<HouseholdBundle>
}

/** What the run reports, so a cron log line says what it did. */
export interface NotifyEvalSummary extends DeliverySummary {
  households: number
  /** Distinct (household, trigger) conditions that fired. */
  firings: number
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

  // The backstop for the prompt up-sync and up-webhook send as each
  // transaction lands: a delivery that failed then is retried here.
  firings.push(
    ...reviewFirings(bundle.reviewTransactions, {
      accounts: bundle.accounts,
      members: bundle.memberConnections,
      handles: bundle.upHandles,
      categories: bundle.upCategories,
      linkedTransactionIds,
    }, now),
  )

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
 * not dismissed it as "not a gift" — that entered the category within the
 * window and was posted within {@link GIFT_CANDIDATE_MAX_AGE_DAYS}.
 *
 * `external_category_since` is when the sync first saw the row in its current
 * category: a later rescan that finds it unchanged leaves it alone, so it marks
 * when the candidate actually arrived — on insert, or when the household
 * recategorised an already-synced purchase into gifts — not when it was last
 * reconfirmed.
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
  const arrivedMs = now.getTime() - Date.parse(transaction.external_category_since)
  const postedMs = now.getTime() - Date.parse(transaction.posted_at)
  return arrivedMs <= NEW_GIFT_CANDIDATE_WINDOW_DAYS * 86_400_000 &&
    postedMs <= GIFT_CANDIDATE_MAX_AGE_DAYS * 86_400_000
}

/** Runs the evaluation across every household. */
export async function runNotifyEval(deps: NotifyEvalDeps): Promise<NotifyEvalSummary> {
  const now = deps.now()
  const financialYear = financialYearForDate(now)
  const summary: NotifyEvalSummary = { households: 0, firings: 0, ...emptyDeliverySummary() }

  for (const householdId of await deps.loadHouseholdIds()) {
    summary.households += 1
    const bundle = await deps.loadBundle(householdId, financialYear)
    const firings = evaluateHousehold(bundle, now)
    summary.firings += firings.length
    addDeliverySummary(summary, await deliverFirings(deps, householdId, firings, now))
  }

  return summary
}
