/**
 * The `transaction_review` trigger: a prompt to a member to confirm the Up
 * category of a transaction they made, opening the review screen on it.
 *
 * `up-sync` and `up-webhook` notify for the rows they insert, the moment they
 * land; `notify-eval` re-evaluates the last {@link REVIEW_BACKSTOP_DAYS} days
 * daily, so a delivery that failed transiently is retried. The dedupe key is
 * the transaction id, so whichever runs first is the only one to send.
 *
 * Gift-surprise protection is why a joint account's transaction notifies only
 * its purchaser: the partner it may be a present for is never told. The
 * purchaser is Up's `performingCustomer` (`performing_customer_name`), whose
 * `displayName` is the customer's Up handle (`$name`), not their Nest name.
 * {@link resolvePurchaser} matches it to a member through the handles each
 * member's own individual accounts carry, and notifies nobody when it cannot
 * name exactly one member.
 */

import {
  deliverFirings,
  type DeliveryDeps,
  type DeliverySummary,
  type Firing,
  formatCents,
} from './notify.ts'

/**
 * A transaction is announced only when Up dated it within this many hours of
 * its first sight in the ledger, so a backfill of history never is.
 */
export const REVIEW_FRESH_HOURS = 48

/** How far back `notify-eval` re-evaluates first sights, retrying a failed delivery. */
export const REVIEW_BACKSTOP_DAYS = 2

const HOUR_MS = 3_600_000

/** The `transactions` columns the trigger reads. */
export interface ReviewTransactionRow {
  id: string
  account_id: string
  description: string
  amount_cents: number
  /** Up's settlement instant, or its creation instant while the hold stands. */
  posted_at: string
  /** When the ledger first saw the transaction. */
  created_at: string
  is_categorizable: boolean | null
  reviewed_at: string | null
  external_category: string | null
  performing_customer_name: string | null
}

/** The `accounts` columns the trigger reads: null `owner_member_id` is a joint account. */
export interface ReviewAccountRow {
  id: string
  owner_member_id: string | null
}

/** A household member, by the name Nest knows them as. */
export interface ReviewMemberRow {
  id: string
  name: string
}

/** An Up handle a member's own individual accounts carry (`up_customer_handles`). */
export interface UpHandleRow {
  member_id: string
  handle: string
}

/** An `up_category` row, for the category's display name. */
export interface UpCategoryNameRow {
  id: string
  name: string
}

/** Everything besides the transactions that deciding who to notify reads. */
export interface ReviewContext {
  accounts: readonly ReviewAccountRow[]
  members: readonly ReviewMemberRow[]
  handles: readonly UpHandleRow[]
  categories: readonly UpCategoryNameRow[]
  /** Transactions a gift purchase links: already handled, never announced. */
  linkedTransactionIds: ReadonlySet<string>
}

/** Case- and space-insensitive comparison form of a name or handle. */
function normalise(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The member who made a joint-account transaction, from Up's performing
 * customer name, or null when no one member is a confident match.
 *
 * A handle seen on exactly one member's individual accounts names that member.
 * Failing that, the name without its leading `$` must equal one member's whole
 * name or first name, among members with no handle on record (a member whose
 * handle is known and differs did not make it).
 */
export function resolvePurchaser(
  performingCustomerName: string | null,
  members: readonly ReviewMemberRow[],
  handles: readonly UpHandleRow[],
): string | null {
  if (performingCustomerName == null || performingCustomerName.trim() === '') return null
  const name = normalise(performingCustomerName)
  const memberIds = new Set(members.map((member) => member.id))

  const byHandle = new Set(
    handles
      .filter((row) => memberIds.has(row.member_id) && normalise(row.handle) === name)
      .map((row) => row.member_id),
  )
  if (byHandle.size === 1) return [...byHandle][0]
  if (byHandle.size > 1) return null

  const withHandle = new Set(handles.map((row) => row.member_id))
  const bare = name.replace(/^\$/, '')
  const byName = members.filter((member) => {
    if (withHandle.has(member.id)) return false
    const full = normalise(member.name)
    return full === bare || full.split(' ')[0] === bare
  })
  return byName.length === 1 ? byName[0].id : null
}

/**
 * Whether a transaction is one to prompt for at `now`: categorisable, not yet
 * reviewed, first seen within {@link REVIEW_BACKSTOP_DAYS}, and dated by Up
 * within {@link REVIEW_FRESH_HOURS} of that first sight.
 */
export function isReviewable(transaction: ReviewTransactionRow, now: Date): boolean {
  if (transaction.is_categorizable !== true || transaction.reviewed_at != null) return false
  const firstSeen = Date.parse(transaction.created_at)
  return now.getTime() - firstSeen <= REVIEW_BACKSTOP_DAYS * 24 * HOUR_MS &&
    firstSeen - Date.parse(transaction.posted_at) <= REVIEW_FRESH_HOURS * HOUR_MS
}

/** The notification for one transaction, e.g. "Myer · $42.10" / "Shopping — right category?". */
export function reviewPayload(
  transaction: ReviewTransactionRow,
  categories: readonly UpCategoryNameRow[],
): Firing['payload'] {
  const label = transaction.description.trim() || 'A transaction'
  const amount = transaction.amount_cents > 0
    ? `+${formatCents(transaction.amount_cents)}`
    : formatCents(Math.abs(transaction.amount_cents))
  const category = transaction.external_category == null
    ? null
    : categories.find((row) => row.id === transaction.external_category)?.name ??
      transaction.external_category
  return {
    title: `${label} · ${amount}`,
    body: category == null ? 'Uncategorised — pick a category?' : `${category} — right category?`,
    url: `/transactions/review?id=${transaction.id}`,
  }
}

/**
 * The review prompts for `transactions` at `now`, each for the one member it
 * goes to: an individual account's owner, or a joint account's purchaser. A
 * joint transaction with no confident purchaser, or a transaction a gift
 * purchase links, produces none.
 */
export function reviewFirings(
  transactions: readonly ReviewTransactionRow[],
  context: ReviewContext,
  now: Date,
): Firing[] {
  const accounts = new Map(context.accounts.map((account) => [account.id, account]))
  const firings: Firing[] = []
  for (const transaction of transactions) {
    if (!isReviewable(transaction, now)) continue
    if (context.linkedTransactionIds.has(transaction.id)) continue
    const account = accounts.get(transaction.account_id)
    if (!account) continue
    const memberId = account.owner_member_id ??
      resolvePurchaser(transaction.performing_customer_name, context.members, context.handles)
    if (memberId == null) {
      console.warn(
        `No confident purchaser for joint transaction ${transaction.id}; not prompting review`,
      )
      continue
    }
    firings.push({
      trigger: 'transaction_review',
      dedupeKey: transaction.id,
      visibleToMemberId: memberId,
      payload: reviewPayload(transaction, context.categories),
    })
  }
  return firings
}

export interface ReviewNotifyDeps {
  /** The household's Up transactions with these ids. */
  loadTransactions: (householdId: string, ids: string[]) => Promise<ReviewTransactionRow[]>
  loadContext: (householdId: string) => Promise<ReviewContext>
  /** The delivery loop's I/O, bound only once there is a prompt to send. */
  delivery: () => Promise<DeliveryDeps>
}

/** Prompts review of the transactions an ingestion pass just inserted for one household. */
export async function notifyInsertedTransactions(
  deps: ReviewNotifyDeps,
  householdId: string,
  ids: readonly string[],
  now: Date,
): Promise<DeliverySummary | null> {
  if (ids.length === 0) return null
  const transactions = (await deps.loadTransactions(householdId, [...ids]))
    .filter((transaction) => isReviewable(transaction, now))
  if (transactions.length === 0) return null
  const firings = reviewFirings(transactions, await deps.loadContext(householdId), now)
  if (firings.length === 0) return null
  return deliverFirings(await deps.delivery(), householdId, firings, now)
}
