import { z } from 'zod'
import { selectAll, type NestContext } from '../context.ts'
import { ToolError, writeError } from '../errors.ts'
import { deleteById, requireSaver } from './shared.ts'
import { centsSchema, isoDateSchema } from './write.ts'

const interestBpsSchema = z.number().int().min(0).max(10_000)

export const addSavingsGoalInput = z.object({
  name: z.string().trim().min(1),
  target_amount_cents: centsSchema,
  target_date: isoDateSchema.optional(),
  current_balance_cents: centsSchema.optional(),
  linked_account_id: z.uuid().optional(),
  annual_interest_bps: interestBpsSchema.optional(),
  planned_contribution_cents: centsSchema.optional(),
})

export const updateSavingsGoalInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  target_amount_cents: centsSchema.optional(),
  target_date: isoDateSchema.nullable().optional(),
  current_balance_cents: centsSchema.optional(),
  linked_account_id: z.uuid().nullable().optional(),
  annual_interest_bps: interestBpsSchema.nullable().optional(),
  planned_contribution_cents: centsSchema.nullable().optional(),
})

export const deleteSavingsGoalInput = z.object({ id: z.uuid() })

export const reorderSavingsGoalQueueInput = z.object({
  goal_ids: z.array(z.uuid()).min(1).max(200),
})

interface GoalRow {
  id: string
  name: string
  target_amount_cents: number
  target_date: string | null
  current_balance_cents: number
  linked_account_id: string | null
  annual_interest_bps: number | null
  queue_position: number | null
  planned_contribution_cents: number | null
}

/** Creates a savings goal, queued until a savings or investments line funds it. */
export async function addSavingsGoal(ctx: NestContext, input: z.infer<typeof addSavingsGoalInput>) {
  if (input.linked_account_id !== undefined) {
    await requireSaver(ctx, input.linked_account_id)
  }
  const row = {
    name: input.name,
    target_amount_cents: input.target_amount_cents,
    target_date: input.target_date ?? null,
    current_balance_cents: input.current_balance_cents ?? 0,
    linked_account_id: input.linked_account_id ?? null,
    annual_interest_bps: input.annual_interest_bps ?? null,
    queue_position: null,
    planned_contribution_cents: input.planned_contribution_cents ?? null,
  }
  const { data, error } = await ctx.supabase
    .from('savings_goal')
    .insert({ household_id: ctx.householdId, ...row })
    .select('id')
    .single()
  if (error || !data) {
    throw writeError(error)
  }
  return { id: (data as { id: string }).id, ...row }
}

/**
 * Edits a savings goal, changing only the fields given. A null clears the
 * target date, linked saver, interest rate, or planned contribution.
 */
export async function updateSavingsGoal(
  ctx: NestContext,
  input: z.infer<typeof updateSavingsGoalInput>,
) {
  const [goal] = await selectAll<GoalRow>(ctx, 'savings_goal', { id: input.id })
  if (!goal) {
    throw new ToolError('not_found', 'No savings goal matches that id.')
  }
  if (input.linked_account_id && input.linked_account_id !== goal.linked_account_id) {
    await requireSaver(ctx, input.linked_account_id)
  }
  const next = {
    name: input.name ?? goal.name,
    target_amount_cents: input.target_amount_cents ?? goal.target_amount_cents,
    target_date: input.target_date === undefined ? goal.target_date : input.target_date,
    current_balance_cents: input.current_balance_cents ?? goal.current_balance_cents,
    linked_account_id:
      input.linked_account_id === undefined ? goal.linked_account_id : input.linked_account_id,
    annual_interest_bps:
      input.annual_interest_bps === undefined
        ? goal.annual_interest_bps
        : input.annual_interest_bps,
    queue_position: goal.queue_position,
    planned_contribution_cents:
      input.planned_contribution_cents === undefined
        ? goal.planned_contribution_cents
        : input.planned_contribution_cents,
  }
  const { data, error } = await ctx.supabase
    .from('savings_goal')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw writeError(error)
  }
  return { id: input.id, ...next }
}

/** Deletes a savings goal; budget lines that funded it stay, unlinked. */
export async function deleteSavingsGoal(
  ctx: NestContext,
  input: z.infer<typeof deleteSavingsGoalInput>,
) {
  return deleteById(ctx, 'savings_goal', input.id, 'savings goal')
}

/**
 * Orders the queued goals: positions `0..n` follow `goal_ids`, and only goals
 * whose position changes are written.
 */
export async function reorderSavingsGoalQueue(
  ctx: NestContext,
  input: z.infer<typeof reorderSavingsGoalQueueInput>,
) {
  if (new Set(input.goal_ids).size !== input.goal_ids.length) {
    throw new ToolError('invalid_details', 'goal_ids lists a goal more than once.')
  }
  const goals = await selectAll<GoalRow>(ctx, 'savings_goal')
  const byId = new Map(goals.map((goal) => [goal.id, goal]))
  for (const id of input.goal_ids) {
    if (!byId.has(id)) {
      throw new ToolError('not_found', 'No savings goal matches one of the ids.')
    }
  }
  const moved = input.goal_ids.flatMap((id, position) =>
    byId.get(id)!.queue_position === position ? [] : [{ id, position }],
  )
  const results = await Promise.all(
    moved.map(({ id, position }) =>
      ctx.supabase
        .from('savings_goal')
        .update({ queue_position: position })
        .eq('id', id)
        .eq('household_id', ctx.householdId)
        .select('id'),
    ),
  )
  if (results.some((result) => result.error || !result.data || result.data.length === 0)) {
    throw writeError(null)
  }
  return {
    queue: input.goal_ids.map((id, position) => ({ id, queue_position: position })),
    moved: moved.length,
  }
}
