import type { Tables } from './database.types'
import { GIFT_TRANSACTION_CATEGORY } from './giftCandidates'

/** The columns the review screen reads from a transaction. */
export const REVIEW_TRANSACTION_COLUMNS =
  'id,account_id,amount_cents,description,posted_at,status,external_category,external_parent_category,deep_link_url,is_categorizable,up_message,up_note,notes,reviewed_at'

/** A transaction as the review screen reads it. */
export type ReviewTransaction = Pick<
  Tables<'transactions'>,
  | 'id'
  | 'account_id'
  | 'amount_cents'
  | 'description'
  | 'posted_at'
  | 'status'
  | 'external_category'
  | 'external_parent_category'
  | 'deep_link_url'
  | 'is_categorizable'
  | 'up_message'
  | 'up_note'
  | 'notes'
  | 'reviewed_at'
>

/** One of Up's categories: a parent (`parent_id` null) or a child under one. */
export type UpCategory = Tables<'up_category'>

/** The most unreviewed transactions the screen loads at once, newest first. */
export const REVIEW_PAGE_SIZE = 100

/** A category picker group: a parent category and its assignable children. */
export interface CategoryGroup {
  group: string
  items: { value: string; label: string }[]
}

/**
 * Up's child categories grouped under their parents, both alphabetical. Only a
 * child can be assigned to a transaction, so a parent is a heading, not a choice.
 */
export function categoryGroups(categories: readonly UpCategory[]): CategoryGroup[] {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  return categories
    .filter((category) => category.parent_id === null)
    .sort(byName)
    .map((parent) => ({
      group: parent.name,
      items: categories
        .filter((category) => category.parent_id === parent.id)
        .sort(byName)
        .map((child) => ({ value: child.id, label: child.name })),
    }))
    .filter((group) => group.items.length > 0)
}

/**
 * A transaction's Up category as it reads: the parent's name, then the child's
 * (`Good Life › Restaurants & Cafes`), or the child alone where its parent is
 * unknown. Null for an uncategorised transaction. An id Nest has no name for
 * yet reads as itself.
 */
export function categoryLabel(
  categories: readonly UpCategory[],
  categoryId: string | null,
): string | null {
  if (categoryId === null) {
    return null
  }
  const child = categories.find((category) => category.id === categoryId)
  if (!child) {
    return categoryId
  }
  const parent = categories.find((category) => category.id === child.parent_id)
  return parent ? `${parent.name} › ${child.name}` : child.name
}

/** Whether a transaction already sits in the category the Gifts inbox reads. */
export function isGift(transaction: Pick<ReviewTransaction, 'external_category'>): boolean {
  return transaction.external_category === GIFT_TRANSACTION_CATEGORY
}

/** A failed review action, carrying the stable code that picks its copy. */
export class ReviewError extends Error {
  constructor(readonly code: string | null) {
    super(code ?? 'review_failed')
    this.name = 'ReviewError'
  }
}

/** The codes whose fix is in Connections, so their message links there. */
const CONNECTIONS_CODES = new Set(['up_not_connected', 'up_auth_failed'])

const REVIEW_ERROR_COPY: Record<string, string> = {
  invalid_request: 'Nest could not send that change. Try again.',
  transaction_not_found: 'Nest can no longer find this transaction.',
  not_up_transaction: 'Only an Up transaction can be recategorised.',
  not_categorisable: 'Up does not let this transaction be categorised.',
  unknown_category: 'Up does not have that category. Pick another.',
  parent_category: 'Pick a subcategory: Up assigns only those to a transaction.',
  server_error: 'Something went wrong. Try again.',
  up_not_connected: 'Connect Up in Connections to change a category.',
  up_auth_failed: 'Up rejected your token. Reconnect Up in Connections.',
  up_rate_limited: 'Up is busy right now. Try again in a minute.',
  up_transaction_not_found: 'Up has no such transaction for your token.',
  up_rejected: 'Up would not accept that category for this transaction.',
  up_unavailable: 'Up is unavailable right now. Try again shortly.',
  save_failed: "Saved in Up, but Nest couldn't update its copy. Try again.",
}

/** Nest's own copy for a failed review action, per code; never the upstream text. */
export function reviewErrorMessage(code: string | null): string {
  return (code && REVIEW_ERROR_COPY[code]) || 'Could not save this review. Try again.'
}

/** Whether a failure is fixed in Connections, so its message offers a link there. */
export function reviewErrorNeedsConnections(code: string | null): boolean {
  return code !== null && CONNECTIONS_CODES.has(code)
}
