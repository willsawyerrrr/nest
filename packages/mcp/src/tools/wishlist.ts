import { z } from 'zod'
import { resolveMember, selectAll, type NestContext } from '../context.ts'
import { ToolError, writeError } from '../errors.ts'
import { deleteById } from './shared.ts'
import { centsSchema } from './write.ts'

export const updateWishlistItemInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  amount_cents: centsSchema.positive().optional(),
  member: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().min(1).nullable().optional(),
})

export const deleteWishlistItemInput = z.object({ id: z.uuid() })

interface WishlistRow {
  id: string
  name: string
  amount_cents: number
  member_id: string | null
  note: string | null
}

/**
 * Edits a wishlist item, changing only the fields given. A null `member` or
 * `note` clears it.
 */
export async function updateWishlistItem(
  ctx: NestContext,
  input: z.infer<typeof updateWishlistItemInput>,
) {
  const [existing] = await selectAll<WishlistRow>(ctx, 'wishlist_item', { id: input.id })
  if (!existing) {
    throw new ToolError('not_found', 'No wishlist item matches that id.')
  }
  const member =
    input.member === undefined
      ? undefined
      : input.member === null
        ? null
        : await resolveMember(ctx, input.member)
  const next = {
    name: input.name ?? existing.name,
    amount_cents: input.amount_cents ?? existing.amount_cents,
    member_id: member === undefined ? existing.member_id : (member?.id ?? null),
    note: input.note === undefined ? existing.note : input.note,
  }
  const { data, error } = await ctx.supabase
    .from('wishlist_item')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw writeError(error)
  }
  return { id: input.id, ...next }
}

/** Deletes a wishlist item. */
export async function deleteWishlistItem(
  ctx: NestContext,
  input: z.infer<typeof deleteWishlistItemInput>,
) {
  return deleteById(ctx, 'wishlist_item', input.id, 'wishlist item')
}
