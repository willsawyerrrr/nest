import type { Tables } from './database.types'
import { isoDate } from './dates'
import type { GiftBudget, GiftOccasion, GiftPurchase, GiftRecipient } from './gifts'

/**
 * The Up category the gift inbox is built from. Up assigns it to gift spending
 * and to charity donations alike, which is why a candidate can be set aside.
 */
export const GIFT_TRANSACTION_CATEGORY = 'gifts-and-charity'

/** A synced Up transaction in the gift category, offered as a gift purchase. */
export type GiftTransaction = Tables<'transactions'>
/** A gift transaction the household marked "not a gift" (Up's category covers charity too). */
export type GiftTransactionDismissal = Tables<'gift_transaction_dismissal'>

/** One unclaimed gift transaction, in the shape the inbox renders. */
export interface GiftCandidate {
  transactionId: string
  description: string
  /** The transaction's magnitude in cents: Up signs a debit negative. */
  amountCents: number
  /** The local calendar date the transaction posted (`YYYY-MM-DD`). */
  postedOn: string
  /** The transaction is still held, so it may settle at a different amount. */
  pending: boolean
}

/** A candidate set aside as "not a gift", carrying the dismissal that undoes it. */
export interface DismissedGiftCandidate extends GiftCandidate {
  dismissalId: string
}

/** One selectable gift budget: its id and a "recipient — occasion" label. */
export interface GiftBudgetChoice {
  value: string
  label: string
}

function toCandidate(transaction: GiftTransaction): GiftCandidate {
  return {
    transactionId: transaction.id,
    description: transaction.description,
    amountCents: Math.abs(transaction.amount_cents),
    postedOn: isoDate(new Date(transaction.posted_at)),
    pending: transaction.status === 'pending',
  }
}

/** Orders transactions newest first, with the id as a stable tiebreak. */
function comparePostedAt(a: GiftTransaction, b: GiftTransaction): number {
  if (a.posted_at !== b.posted_at) {
    return a.posted_at < b.posted_at ? 1 : -1
  }
  return a.id.localeCompare(b.id)
}

/**
 * The gift inbox: every synced gift transaction the household has neither
 * claimed as a purchase nor set aside, newest first.
 *
 * A purchase may point at a transaction that is absent here — it aged out of
 * the polled window, or it sits on an account whose balances the signed-in
 * member cannot see — which changes nothing: the purchase still shows in its
 * gift row, and only a transaction actually present can be a candidate.
 *
 * The inbox cannot spoil a surprise from the other direction either: RLS
 * withholds a transaction claimed as a gift for the signed-in member, whichever
 * account paid for it, so it never reaches this list to be offered back to them.
 */
export function giftCandidates(
  transactions: GiftTransaction[],
  purchases: GiftPurchase[],
  dismissals: GiftTransactionDismissal[],
): GiftCandidate[] {
  const claimed = new Set<string>([
    ...purchases
      .map((purchase) => purchase.transaction_id)
      .filter((id): id is string => id !== null),
    ...dismissals.map((dismissal) => dismissal.transaction_id),
  ])
  return [...transactions]
    .filter((transaction) => !claimed.has(transaction.id))
    .sort(comparePostedAt)
    .map(toCandidate)
}

/**
 * The candidates set aside as "not a gift", newest first, each with its
 * dismissal id so the household can restore it.
 *
 * A dismissal is visible to the whole household while the transaction behind it
 * may not be — a co-member's spending account stays private — so a dismissal
 * with no visible transaction is dropped rather than shown as a blank row.
 */
export function dismissedGiftCandidates(
  transactions: GiftTransaction[],
  dismissals: GiftTransactionDismissal[],
): DismissedGiftCandidate[] {
  const dismissalByTransaction = new Map(
    dismissals.map((dismissal) => [dismissal.transaction_id, dismissal.id]),
  )
  return [...transactions]
    .filter((transaction) => dismissalByTransaction.has(transaction.id))
    .sort(comparePostedAt)
    .map((transaction) => ({
      ...toCandidate(transaction),
      dismissalId: dismissalByTransaction.get(transaction.id)!,
    }))
}

/**
 * The gift budgets a candidate can be linked to, labelled "recipient —
 * occasion" and ordered by that label.
 *
 * A gift for the signed-in member is excluded: RLS blocks them logging a
 * purchase against it (the spend is hidden from them), so offering the budget
 * would only fail on save.
 */
export function linkableGiftBudgets(
  budgets: GiftBudget[],
  recipients: GiftRecipient[],
  occasions: GiftOccasion[],
  hiddenBudgetIds: ReadonlySet<string>,
): GiftBudgetChoice[] {
  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]))
  const occasionById = new Map(occasions.map((occasion) => [occasion.id, occasion]))
  return budgets
    .filter((budget) => !hiddenBudgetIds.has(budget.id))
    .map((budget): GiftBudgetChoice | null => {
      const recipient = recipientById.get(budget.recipient_id)
      const occasion = occasionById.get(budget.occasion_id)
      if (!recipient || !occasion) {
        return null
      }
      return { value: budget.id, label: `${recipient.name} — ${occasion.name}` }
    })
    .filter((choice): choice is GiftBudgetChoice => choice !== null)
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
}
