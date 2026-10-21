import { z } from 'zod'
import { annualCents, fortnightlyCents, type Frequency } from '@nest/plan'
import { selectAll, type NestContext } from '../context.ts'
import { ToolError, writeError } from '../errors.ts'
import { BUDGET_GROUPS, FREQUENCIES, intervalFor, intervalSchema } from './budgetLines.ts'
import { deleteById } from './shared.ts'
import { centsSchema } from './write.ts'

export const addBreakdownInput = z.object({
  name: z.string().trim().min(1),
  group: z.enum(BUDGET_GROUPS),
})

export const updateBreakdownInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  group: z.enum(BUDGET_GROUPS).optional(),
})

export const deleteBreakdownInput = z.object({ id: z.uuid() })

export const addBreakdownItemInput = z.object({
  breakdown_id: z.uuid(),
  name: z.string().trim().min(1),
  amount_cents: centsSchema,
  frequency: z.enum(FREQUENCIES),
  interval_count: intervalSchema.optional(),
})

export const updateBreakdownItemInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  amount_cents: centsSchema.optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  interval_count: intervalSchema.optional(),
})

export const deleteBreakdownItemInput = z.object({ id: z.uuid() })

interface BreakdownRecord {
  id: string
  name: string
  line_group: (typeof BUDGET_GROUPS)[number]
}

interface ItemRecord {
  id: string
  breakdown_id: string
  name: string
  amount_cents: number
  frequency: Frequency
  interval_count: number | null
}

const shapeItem = (item: ItemRecord) => {
  const interval = item.interval_count ?? undefined
  return {
    id: item.id,
    name: item.name,
    amount_cents: item.amount_cents,
    frequency: item.frequency,
    interval_count: item.interval_count,
    fortnightly_cents: fortnightlyCents(item.amount_cents, item.frequency, interval),
    annual_cents: annualCents(item.amount_cents, item.frequency, interval),
  }
}

/**
 * The household's breakdowns: itemised lists whose total is rolled up into one
 * derived budget line each, with every item and the rolled-up totals.
 */
export async function listBreakdowns(ctx: NestContext) {
  const [breakdowns, items, lines] = await Promise.all([
    selectAll<BreakdownRecord>(ctx, 'breakdown'),
    selectAll<ItemRecord>(ctx, 'breakdown_item'),
    selectAll<{ id: string; breakdown_id: string | null }>(ctx, 'budget_line'),
  ])
  const shaped = breakdowns
    .map((breakdown) => {
      const own = items
        .filter((item) => item.breakdown_id === breakdown.id)
        .map(shapeItem)
        .sort((a, b) => a.name.localeCompare(b.name))
      return {
        id: breakdown.id,
        name: breakdown.name,
        group: breakdown.line_group,
        budget_line_id: lines.find((line) => line.breakdown_id === breakdown.id)?.id ?? null,
        items: own,
        fortnightly_cents: own.reduce((sum, item) => sum + item.fortnightly_cents, 0),
        annual_cents: own.reduce((sum, item) => sum + item.annual_cents, 0),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { breakdowns: shaped }
}

/** Creates a breakdown; the household's budget gains its derived line. */
export async function addBreakdown(ctx: NestContext, input: z.infer<typeof addBreakdownInput>) {
  const { data, error } = await ctx.supabase
    .from('breakdown')
    .insert({
      household_id: ctx.householdId,
      name: input.name,
      line_group: input.group,
      kind: 'generic',
    })
    .select('id')
    .single()
  if (error || !data) {
    throw writeError(error)
  }
  return { id: (data as { id: string }).id, name: input.name, group: input.group }
}

/** Renames a breakdown or moves it to another budget group; its derived line follows. */
export async function updateBreakdown(
  ctx: NestContext,
  input: z.infer<typeof updateBreakdownInput>,
) {
  const [existing] = await selectAll<BreakdownRecord>(ctx, 'breakdown', { id: input.id })
  if (!existing) {
    throw new ToolError('not_found', 'No breakdown matches that id.')
  }
  const next = {
    name: input.name ?? existing.name,
    line_group: input.group ?? existing.line_group,
  }
  const { data, error } = await ctx.supabase
    .from('breakdown')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw writeError(error)
  }
  return { id: input.id, name: next.name, group: next.line_group }
}

/** Deletes a breakdown, its items, and its derived budget line. */
export async function deleteBreakdown(
  ctx: NestContext,
  input: z.infer<typeof deleteBreakdownInput>,
) {
  return deleteById(ctx, 'breakdown', input.id, 'breakdown')
}

/** Adds an item to a breakdown; its total rolls up into the breakdown's budget line. */
export async function addBreakdownItem(
  ctx: NestContext,
  input: z.infer<typeof addBreakdownItemInput>,
) {
  const intervalCount = intervalFor(input.frequency, input.interval_count)
  const [parent] = await selectAll<BreakdownRecord>(ctx, 'breakdown', { id: input.breakdown_id })
  if (!parent) {
    throw new ToolError('not_found', 'No breakdown matches that id.')
  }
  const { data, error } = await ctx.supabase
    .from('breakdown_item')
    .insert({
      household_id: ctx.householdId,
      breakdown_id: input.breakdown_id,
      name: input.name,
      amount_cents: input.amount_cents,
      frequency: input.frequency,
      interval_count: intervalCount,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw writeError(error)
  }
  return {
    id: (data as { id: string }).id,
    breakdown_id: input.breakdown_id,
    name: input.name,
    amount_cents: input.amount_cents,
    frequency: input.frequency,
    interval_count: intervalCount,
  }
}

/** Edits a breakdown item, changing only the fields given. */
export async function updateBreakdownItem(
  ctx: NestContext,
  input: z.infer<typeof updateBreakdownItemInput>,
) {
  const [existing] = await selectAll<ItemRecord>(ctx, 'breakdown_item', { id: input.id })
  if (!existing) {
    throw new ToolError('not_found', 'No breakdown item matches that id.')
  }
  const frequency = input.frequency ?? existing.frequency
  const intervalCount = intervalFor(
    frequency,
    input.frequency === undefined && input.interval_count === undefined
      ? existing.interval_count
      : input.interval_count,
  )
  const next = {
    name: input.name ?? existing.name,
    amount_cents: input.amount_cents ?? existing.amount_cents,
    frequency,
    interval_count: intervalCount,
  }
  const { data, error } = await ctx.supabase
    .from('breakdown_item')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw writeError(error)
  }
  return { id: input.id, breakdown_id: existing.breakdown_id, ...next }
}

/** Removes an item from its breakdown. */
export async function deleteBreakdownItem(
  ctx: NestContext,
  input: z.infer<typeof deleteBreakdownItemInput>,
) {
  return deleteById(ctx, 'breakdown_item', input.id, 'breakdown item')
}
