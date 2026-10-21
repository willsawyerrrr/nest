import { z } from 'zod'
import { selectAll, type NestContext } from '../context.ts'
import { ToolError } from '../errors.ts'
import {
  deleteRow,
  findById,
  GIFT_TRANSACTION_CATEGORY,
  idSchema,
  insertRow,
  localDate,
  mustFind,
  updateRow,
  type BudgetRow,
  type DiscretionaryRow,
  type DismissalRow,
  type PurchaseRow,
  type RecipientRow,
  type TransactionRow,
} from './giftShared.ts'
import { centsSchema, isoDateSchema } from './write.ts'

export const addGiftPurchaseInput = z.object({
  gift_budget_id: idSchema.optional(),
  ad_hoc: z.literal(true).optional(),
  recipient_id: idSchema.optional(),
  transaction_id: idSchema.optional(),
  amount_cents: centsSchema.optional(),
  description: z.string().trim().optional(),
  purchased_on: isoDateSchema.optional(),
})
export const updateGiftPurchaseInput = z.object({
  id: idSchema,
  gift_budget_id: idSchema.optional(),
  ad_hoc: z.literal(true).optional(),
  unassigned: z.literal(true).optional(),
  recipient_id: idSchema.nullable().optional(),
  amount_cents: centsSchema.optional(),
  description: z.string().trim().optional(),
  purchased_on: isoDateSchema.optional(),
})
export const deleteGiftPurchaseInput = z.object({ id: idSchema })

export const dismissGiftCandidateInput = z.object({ transaction_id: idSchema })
export const restoreGiftCandidateInput = z.object({ dismissal_id: idSchema })

const OWN_GIFT_MESSAGE = 'Purchases for your own gifts are hidden from you and cannot be logged.'

function toCandidate(transaction: TransactionRow) {
  return {
    transaction_id: transaction.id,
    description: transaction.description,
    amount_cents: Math.abs(transaction.amount_cents),
    posted_on: localDate(transaction.posted_at),
    pending: transaction.status === 'pending',
  }
}

/**
 * The "From your card" inbox: synced gift-category Up transactions the member
 * can see that no purchase claims and nobody set aside, plus those set aside as
 * "not a gift". Row-level security already withholds co-members' spending
 * accounts and any transaction claimed as a gift for the member.
 */
export async function listGiftCandidates(ctx: NestContext) {
  const [transactions, purchases, dismissals] = await Promise.all([
    selectAll<TransactionRow>(ctx, 'transactions', {
      external_category: GIFT_TRANSACTION_CATEGORY,
    }),
    selectAll<PurchaseRow>(ctx, 'gift_purchase'),
    selectAll<DismissalRow>(ctx, 'gift_transaction_dismissal'),
  ])
  const claimed = new Set(
    purchases.map((p) => p.transaction_id).filter((id): id is string => id !== null),
  )
  const dismissalByTransaction = new Map(dismissals.map((d) => [d.transaction_id, d.id]))
  const newestFirst = (a: TransactionRow, b: TransactionRow) =>
    b.posted_at.localeCompare(a.posted_at)
  return {
    candidates: transactions
      .filter((t) => !claimed.has(t.id) && !dismissalByTransaction.has(t.id))
      .sort(newestFirst)
      .map(toCandidate),
    dismissed: transactions
      .filter((t) => dismissalByTransaction.has(t.id))
      .sort(newestFirst)
      .map((t) => ({ dismissal_id: dismissalByTransaction.get(t.id)!, ...toCandidate(t) })),
  }
}

interface Destination {
  gift_budget_id: string | null
  gift_discretionary_budget_id: string | null
  recipient_id: string | null
}

/** Refuses a destination that would log a purchase for the member's own gift. */
async function assertNotOwnGift(ctx: NestContext, destination: Destination): Promise<void> {
  if (destination.gift_budget_id !== null) {
    const budget = await mustFind<BudgetRow>(
      ctx,
      'gift_budget',
      destination.gift_budget_id,
      'gift budget',
    )
    const recipient = await findById<RecipientRow>(ctx, 'gift_recipient', budget.recipient_id)
    if (recipient?.member_id === ctx.memberId) throw new ToolError('private_gift', OWN_GIFT_MESSAGE)
  }
  if (destination.recipient_id !== null) {
    const recipient = await mustFind<RecipientRow>(
      ctx,
      'gift_recipient',
      destination.recipient_id,
      'gift recipient',
    )
    if (recipient.member_id === ctx.memberId) throw new ToolError('private_gift', OWN_GIFT_MESSAGE)
  }
}

async function discretionaryBudgetId(ctx: NestContext): Promise<string> {
  const rows = await selectAll<DiscretionaryRow>(ctx, 'gift_discretionary_budget')
  const row = rows[0]
  if (!row) {
    throw new ToolError(
      'invalid_details',
      'Set the ad hoc gifts budget before logging purchases against it.',
    )
  }
  return row.id
}

/**
 * Logs a gift purchase against a gift budget, the ad hoc buffer (optionally
 * tagged with a recipient), or neither. Given a `transaction_id` from
 * `list_gift_candidates` it links that card transaction, taking its amount and
 * date. A purchase for the member's own gift is refused.
 */
export async function addGiftPurchase(
  ctx: NestContext,
  input: z.infer<typeof addGiftPurchaseInput>,
) {
  if (input.gift_budget_id !== undefined && input.ad_hoc) {
    throw new ToolError('invalid_details', 'Choose a gift budget or ad_hoc, not both.')
  }
  if (input.recipient_id !== undefined && !input.ad_hoc) {
    throw new ToolError('invalid_details', 'recipient_id tags an ad hoc purchase only.')
  }
  let amountCents = input.amount_cents
  let purchasedOn = input.purchased_on
  if (input.transaction_id !== undefined) {
    if (amountCents !== undefined || purchasedOn !== undefined) {
      throw new ToolError(
        'invalid_details',
        'A linked purchase takes its amount and date from the transaction.',
      )
    }
    const transaction = await findById<TransactionRow>(ctx, 'transactions', input.transaction_id)
    if (!transaction || transaction.external_category !== GIFT_TRANSACTION_CATEGORY) {
      throw new ToolError('not_found', 'No gift transaction matches that id.')
    }
    amountCents = Math.abs(transaction.amount_cents)
    purchasedOn = localDate(transaction.posted_at)
  } else if (amountCents === undefined || purchasedOn === undefined) {
    throw new ToolError('invalid_details', 'amount_cents and purchased_on are required.')
  }
  const destination: Destination = {
    gift_budget_id: input.gift_budget_id ?? null,
    gift_discretionary_budget_id: input.ad_hoc ? await discretionaryBudgetId(ctx) : null,
    recipient_id: input.recipient_id ?? null,
  }
  await assertNotOwnGift(ctx, destination)
  const row = {
    ...destination,
    amount_cents: amountCents,
    description: input.description ?? '',
    purchased_on: purchasedOn,
    transaction_id: input.transaction_id ?? null,
  }
  const id = await insertRow(ctx, 'gift_purchase', row)
  return { id, ...row }
}

/**
 * Edits a purchase, changing only the fields given. `gift_budget_id`, `ad_hoc`,
 * or `unassigned` moves it; `recipient_id` (null clears) tags an ad hoc one. A
 * purchase linked to a card transaction keeps that transaction's amount and date.
 */
export async function updateGiftPurchase(
  ctx: NestContext,
  input: z.infer<typeof updateGiftPurchaseInput>,
) {
  const found = await mustFind<PurchaseRow>(ctx, 'gift_purchase', input.id, 'gift purchase')
  const moves = [input.gift_budget_id !== undefined, input.ad_hoc, input.unassigned].filter(Boolean)
  if (moves.length > 1) {
    throw new ToolError('invalid_details', 'Choose one of gift_budget_id, ad_hoc, or unassigned.')
  }
  if (
    found.transaction_id !== null &&
    (input.amount_cents !== undefined || input.purchased_on !== undefined)
  ) {
    throw new ToolError(
      'invalid_details',
      'A linked purchase follows its transaction; only its description and destination can change.',
    )
  }
  const moved = moves.length === 1
  const adHoc = moved ? input.ad_hoc === true : found.gift_discretionary_budget_id !== null
  if (typeof input.recipient_id === 'string' && !adHoc) {
    throw new ToolError('invalid_details', 'recipient_id tags an ad hoc purchase only.')
  }
  const destination: Destination = {
    gift_budget_id: moved ? (input.gift_budget_id ?? null) : found.gift_budget_id,
    gift_discretionary_budget_id: !moved
      ? found.gift_discretionary_budget_id
      : input.ad_hoc
        ? await discretionaryBudgetId(ctx)
        : null,
    recipient_id: !adHoc
      ? null
      : input.recipient_id === undefined
        ? found.recipient_id
        : input.recipient_id,
  }
  await assertNotOwnGift(ctx, destination)
  const next = {
    ...destination,
    amount_cents: input.amount_cents ?? found.amount_cents,
    description: input.description ?? found.description,
    purchased_on: input.purchased_on ?? found.purchased_on,
  }
  await updateRow(ctx, 'gift_purchase', input.id, next)
  return { id: input.id, ...next, transaction_id: found.transaction_id }
}

/** Deletes a purchase the member can see. */
export async function deleteGiftPurchase(
  ctx: NestContext,
  input: z.infer<typeof deleteGiftPurchaseInput>,
) {
  await mustFind<PurchaseRow>(ctx, 'gift_purchase', input.id, 'gift purchase')
  await deleteRow(ctx, 'gift_purchase', input.id)
  return { deleted: input.id }
}

/** Sets an inbox candidate aside as "not a gift". */
export async function dismissGiftCandidate(
  ctx: NestContext,
  input: z.infer<typeof dismissGiftCandidateInput>,
) {
  const transaction = await findById<TransactionRow>(ctx, 'transactions', input.transaction_id)
  if (!transaction || transaction.external_category !== GIFT_TRANSACTION_CATEGORY) {
    throw new ToolError('not_found', 'No gift transaction matches that id.')
  }
  const id = await insertRow(ctx, 'gift_transaction_dismissal', {
    transaction_id: input.transaction_id,
  })
  return { dismissal_id: id, transaction_id: input.transaction_id }
}

/** Undoes a dismissal, returning its transaction to the inbox. */
export async function restoreGiftCandidate(
  ctx: NestContext,
  input: z.infer<typeof restoreGiftCandidateInput>,
) {
  await mustFind<DismissalRow>(ctx, 'gift_transaction_dismissal', input.dismissal_id, 'dismissal')
  await deleteRow(ctx, 'gift_transaction_dismissal', input.dismissal_id)
  return { restored: input.dismissal_id }
}
