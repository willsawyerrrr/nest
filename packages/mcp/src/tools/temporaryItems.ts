import { z } from 'zod'
import { selectAll, type NestContext } from '../context.ts'
import { ToolError, writeError } from '../errors.ts'
import { deleteById } from './shared.ts'
import { centsSchema, isoDateSchema } from './write.ts'

export const addTemporaryItemInput = z.object({
  name: z.string().trim().min(1),
  contribution_cents: centsSchema,
  target_date: isoDateSchema,
})

export const updateTemporaryItemInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  contribution_cents: centsSchema.optional(),
  target_date: isoDateSchema.optional(),
})

export const deleteTemporaryItemInput = z.object({ id: z.uuid() })

interface TemporaryItemRow {
  id: string
  name: string
  contribution_cents: number
  target_date: string
}

/** The household's temporary items: fortnightly outflows that run until their target date. */
export async function listTemporaryItems(ctx: NestContext) {
  const rows = await selectAll<TemporaryItemRow>(ctx, 'temporary_item')
  const items = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      contribution_cents: row.contribution_cents,
      target_date: row.target_date,
    }))
    .sort((a, b) => a.target_date.localeCompare(b.target_date) || a.name.localeCompare(b.name))
  return { items }
}

/** Adds a temporary item contributing `contribution_cents` each fortnight until `target_date`. */
export async function addTemporaryItem(
  ctx: NestContext,
  input: z.infer<typeof addTemporaryItemInput>,
) {
  const { data, error } = await ctx.supabase
    .from('temporary_item')
    .insert({
      household_id: ctx.householdId,
      name: input.name,
      contribution_cents: input.contribution_cents,
      target_date: input.target_date,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw writeError(error)
  }
  return {
    id: (data as { id: string }).id,
    name: input.name,
    contribution_cents: input.contribution_cents,
    target_date: input.target_date,
  }
}

/** Edits a temporary item, changing only the fields given. */
export async function updateTemporaryItem(
  ctx: NestContext,
  input: z.infer<typeof updateTemporaryItemInput>,
) {
  const [existing] = await selectAll<TemporaryItemRow>(ctx, 'temporary_item', { id: input.id })
  if (!existing) {
    throw new ToolError('not_found', 'No temporary item matches that id.')
  }
  const next = {
    name: input.name ?? existing.name,
    contribution_cents: input.contribution_cents ?? existing.contribution_cents,
    target_date: input.target_date ?? existing.target_date,
  }
  const { data, error } = await ctx.supabase
    .from('temporary_item')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw writeError(error)
  }
  return { id: input.id, ...next }
}

/** Deletes a temporary item. */
export async function deleteTemporaryItem(
  ctx: NestContext,
  input: z.infer<typeof deleteTemporaryItemInput>,
) {
  return deleteById(ctx, 'temporary_item', input.id, 'temporary item')
}
