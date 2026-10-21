import { z } from 'zod'
import { selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import {
  deleteRow,
  idSchema,
  insertRow,
  mustFind,
  nameSchema,
  updateRow,
  type BudgetRow,
  type DiscretionaryRow,
  type OccasionRow,
  type PurchaseRow,
  type RecipientRow,
} from './giftShared.ts'
import { centsSchema, isoDateSchema } from './write.ts'

export const addGiftRecipientInput = z.object({ name: nameSchema })
export const updateGiftRecipientInput = z.object({ id: idSchema, name: nameSchema })
export const deleteGiftRecipientInput = z.object({ id: idSchema })

export const addGiftOccasionInput = z.object({
  name: nameSchema,
  occasion_date: isoDateSchema.optional(),
})
export const updateGiftOccasionInput = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  occasion_date: isoDateSchema.nullable().optional(),
})
export const deleteGiftOccasionInput = z.object({ id: idSchema })

export const addGiftBudgetInput = z.object({
  recipient_id: idSchema,
  occasion_id: idSchema,
  budgeted_amount_cents: centsSchema,
  event_date: isoDateSchema.optional(),
})
export const updateGiftBudgetInput = z.object({
  id: idSchema,
  recipient_id: idSchema.optional(),
  occasion_id: idSchema.optional(),
  budgeted_amount_cents: centsSchema.optional(),
  event_date: isoDateSchema.nullable().optional(),
})
export const deleteGiftBudgetInput = z.object({ id: idSchema })

export const setGiftDiscretionaryBudgetInput = z.object({ budgeted_amount_cents: centsSchema })

function assertExternal(recipient: RecipientRow): void {
  if (recipient.member_id !== null) {
    throw new ToolError(
      'member_recipient',
      'Household members are permanent gift recipients and cannot be edited or deleted.',
    )
  }
}

const sum = (rows: { amount_cents: number }[]) =>
  rows.reduce((total, row) => total + row.amount_cents, 0)

/**
 * The gift tracker: recipients, occasions, per-recipient budgets with spent and
 * remaining, the ad hoc buffer, and the purchases the member may see. The
 * purchases against the member's own gifts are hidden by row-level security, so
 * those budgets report no spent or remaining rather than a misleading zero.
 */
export async function listGifts(ctx: NestContext) {
  const [recipients, occasions, budgets, purchases, discretionary] = await Promise.all([
    selectAll<RecipientRow>(ctx, 'gift_recipient'),
    selectAll<OccasionRow>(ctx, 'gift_occasion'),
    selectAll<BudgetRow>(ctx, 'gift_budget'),
    selectAll<PurchaseRow>(ctx, 'gift_purchase'),
    selectAll<DiscretionaryRow>(ctx, 'gift_discretionary_budget'),
  ])
  const recipientById = new Map(recipients.map((row) => [row.id, row]))
  const occasionById = new Map(occasions.map((row) => [row.id, row]))
  const buffer = discretionary[0] ?? null
  const bufferSpent = sum(purchases.filter((p) => p.gift_discretionary_budget_id !== null))

  return {
    recipients: recipients
      .map((row) => ({
        id: row.id,
        name: row.name,
        is_member: row.member_id !== null,
        is_you: row.member_id === ctx.memberId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    occasions: occasions
      .map((row) => ({ id: row.id, name: row.name, occasion_date: row.occasion_date }))
      .sort((a, b) => (a.occasion_date ?? '9999').localeCompare(b.occasion_date ?? '9999')),
    budgets: budgets.map((row) => {
      const recipient = recipientById.get(row.recipient_id)
      const occasion = occasionById.get(row.occasion_id)
      const hidden = recipient?.member_id === ctx.memberId
      const spent = hidden ? null : sum(purchases.filter((p) => p.gift_budget_id === row.id))
      return {
        id: row.id,
        recipient_id: row.recipient_id,
        recipient: recipient?.name ?? null,
        occasion_id: row.occasion_id,
        occasion: occasion?.name ?? null,
        budgeted_amount_cents: row.budgeted_amount_cents,
        event_date: row.event_date,
        date: row.event_date ?? occasion?.occasion_date ?? null,
        private: hidden,
        spent_cents: spent,
        remaining_cents: spent === null ? null : row.budgeted_amount_cents - spent,
      }
    }),
    discretionary: {
      id: buffer?.id ?? null,
      budgeted_amount_cents: buffer?.budgeted_amount_cents ?? 0,
      spent_cents: bufferSpent,
      remaining_cents: (buffer?.budgeted_amount_cents ?? 0) - bufferSpent,
    },
    unassigned_spent_cents: sum(
      purchases.filter((p) => p.gift_budget_id === null && p.gift_discretionary_budget_id === null),
    ),
    purchases: purchases
      .map((row) => ({
        id: row.id,
        description: row.description,
        amount_cents: row.amount_cents,
        purchased_on: row.purchased_on,
        gift_budget_id: row.gift_budget_id,
        ad_hoc: row.gift_discretionary_budget_id !== null,
        recipient_id: row.recipient_id,
        transaction_id: row.transaction_id,
      }))
      .sort((a, b) => b.purchased_on.localeCompare(a.purchased_on)),
  }
}

/** Adds an external gift recipient. */
export async function addGiftRecipient(
  ctx: NestContext,
  input: z.infer<typeof addGiftRecipientInput>,
) {
  const id = await insertRow(ctx, 'gift_recipient', { name: input.name })
  return { id, name: input.name }
}

/** Renames an external gift recipient; a household member's recipient is refused. */
export async function updateGiftRecipient(
  ctx: NestContext,
  input: z.infer<typeof updateGiftRecipientInput>,
) {
  assertExternal(await mustFind<RecipientRow>(ctx, 'gift_recipient', input.id, 'gift recipient'))
  await updateRow(ctx, 'gift_recipient', input.id, { name: input.name })
  return { id: input.id, name: input.name }
}

/** Deletes an external gift recipient with its budgets and their purchases. */
export async function deleteGiftRecipient(
  ctx: NestContext,
  input: z.infer<typeof deleteGiftRecipientInput>,
) {
  assertExternal(await mustFind<RecipientRow>(ctx, 'gift_recipient', input.id, 'gift recipient'))
  await deleteRow(ctx, 'gift_recipient', input.id)
  return { deleted: input.id }
}

/** Adds a gifting occasion with an optional date. */
export async function addGiftOccasion(
  ctx: NestContext,
  input: z.infer<typeof addGiftOccasionInput>,
) {
  const occasionDate = input.occasion_date ?? null
  const id = await insertRow(ctx, 'gift_occasion', {
    name: input.name,
    occasion_date: occasionDate,
  })
  return { id, name: input.name, occasion_date: occasionDate }
}

/** Edits an occasion, changing only the fields given; `occasion_date: null` clears the date. */
export async function updateGiftOccasion(
  ctx: NestContext,
  input: z.infer<typeof updateGiftOccasionInput>,
) {
  const found = await mustFind<OccasionRow>(ctx, 'gift_occasion', input.id, 'gift occasion')
  const next = {
    name: input.name ?? found.name,
    occasion_date: input.occasion_date === undefined ? found.occasion_date : input.occasion_date,
  }
  await updateRow(ctx, 'gift_occasion', input.id, next)
  return { id: input.id, ...next }
}

/** Deletes an occasion with its budgets and their purchases. */
export async function deleteGiftOccasion(
  ctx: NestContext,
  input: z.infer<typeof deleteGiftOccasionInput>,
) {
  await mustFind<OccasionRow>(ctx, 'gift_occasion', input.id, 'gift occasion')
  await deleteRow(ctx, 'gift_occasion', input.id)
  return { deleted: input.id }
}

async function assertPairFree(
  ctx: NestContext,
  recipientId: string,
  occasionId: string,
  exceptId?: string,
): Promise<void> {
  const budgets = await selectAll<BudgetRow>(ctx, 'gift_budget')
  if (
    budgets.some(
      (b) => b.recipient_id === recipientId && b.occasion_id === occasionId && b.id !== exceptId,
    )
  ) {
    throw new ToolError(
      'invalid_details',
      'A budget already exists for that recipient and occasion.',
    )
  }
}

/** Plans a gift spend for a recipient on an occasion. */
export async function addGiftBudget(ctx: NestContext, input: z.infer<typeof addGiftBudgetInput>) {
  await mustFind<RecipientRow>(ctx, 'gift_recipient', input.recipient_id, 'gift recipient')
  await mustFind<OccasionRow>(ctx, 'gift_occasion', input.occasion_id, 'gift occasion')
  await assertPairFree(ctx, input.recipient_id, input.occasion_id)
  const eventDate = input.event_date ?? null
  const id = await insertRow(ctx, 'gift_budget', {
    recipient_id: input.recipient_id,
    occasion_id: input.occasion_id,
    budgeted_amount_cents: input.budgeted_amount_cents,
    event_date: eventDate,
  })
  return {
    id,
    recipient_id: input.recipient_id,
    occasion_id: input.occasion_id,
    budgeted_amount_cents: input.budgeted_amount_cents,
    event_date: eventDate,
  }
}

/** Edits a gift budget, changing only the fields given; `event_date: null` falls back to the occasion's date. */
export async function updateGiftBudget(
  ctx: NestContext,
  input: z.infer<typeof updateGiftBudgetInput>,
) {
  const found = await mustFind<BudgetRow>(ctx, 'gift_budget', input.id, 'gift budget')
  const next = {
    recipient_id: input.recipient_id ?? found.recipient_id,
    occasion_id: input.occasion_id ?? found.occasion_id,
    budgeted_amount_cents: input.budgeted_amount_cents ?? found.budgeted_amount_cents,
    event_date: input.event_date === undefined ? found.event_date : input.event_date,
  }
  if (input.recipient_id !== undefined) {
    await mustFind<RecipientRow>(ctx, 'gift_recipient', input.recipient_id, 'gift recipient')
  }
  if (input.occasion_id !== undefined) {
    await mustFind<OccasionRow>(ctx, 'gift_occasion', input.occasion_id, 'gift occasion')
  }
  await assertPairFree(ctx, next.recipient_id, next.occasion_id, input.id)
  await updateRow(ctx, 'gift_budget', input.id, next)
  return { id: input.id, ...next }
}

/** Deletes a gift budget with its purchases. */
export async function deleteGiftBudget(
  ctx: NestContext,
  input: z.infer<typeof deleteGiftBudgetInput>,
) {
  await mustFind<BudgetRow>(ctx, 'gift_budget', input.id, 'gift budget')
  await deleteRow(ctx, 'gift_budget', input.id)
  return { deleted: input.id }
}

/** Sets the household's single ad hoc gift buffer amount, creating it on first use. */
export async function setGiftDiscretionaryBudget(
  ctx: NestContext,
  input: z.infer<typeof setGiftDiscretionaryBudgetInput>,
) {
  const { data, error } = await ctx.supabase
    .from('gift_discretionary_budget')
    .upsert(
      { household_id: ctx.householdId, budgeted_amount_cents: input.budgeted_amount_cents },
      { onConflict: 'household_id' },
    )
    .select('id')
    .single()
  if (error || !data) throw fixedError('save_failed')
  return { id: (data as { id: string }).id, budgeted_amount_cents: input.budgeted_amount_cents }
}
