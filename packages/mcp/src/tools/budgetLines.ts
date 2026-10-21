import { z } from 'zod'
import type { Frequency } from '@nest/plan'
import { resolveMember, selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError, writeError } from '../errors.ts'
import { deleteById, requireAccount } from './shared.ts'
import { centsSchema } from './write.ts'

export const BUDGET_GROUPS = ['needs', 'wants', 'discretionary', 'savings', 'investments'] as const

export const FREQUENCIES = [
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'biannual',
  'annual',
  'every_n_weeks',
  'every_n_months',
] as const satisfies readonly Frequency[]

const MANAGEMENT_URL_MAX_LENGTH = 2048

/** A bare web address (`netflix.com/account`): dotted host labels, then an optional path, query, or fragment. */
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$/i

/** A storable http(s) URL from a typed link (a bare domain gains `https://`), or `null` when it is not one. */
function normaliseManagementUrl(value: string): string | null {
  const trimmed = value.trim()
  const candidate = BARE_DOMAIN.test(trimmed) ? `https://${trimmed}` : trimmed
  if (candidate.length > MANAGEMENT_URL_MAX_LENGTH || /\s/.test(candidate)) return null
  try {
    const { protocol } = new URL(candidate)
    return protocol === 'http:' || protocol === 'https:' ? candidate : null
  } catch {
    return null
  }
}

const managementUrlSchema = z
  .string()
  .refine((value) => normaliseManagementUrl(value) !== null, 'Expected an http(s) web address')

export const intervalSchema = z.number().int().min(1).max(1_000)

export const addBudgetLineInput = z.object({
  name: z.string().trim().min(1),
  group: z.enum(BUDGET_GROUPS),
  amount_cents: centsSchema,
  frequency: z.enum(FREQUENCIES),
  interval_count: intervalSchema.optional(),
  management_url: managementUrlSchema.optional(),
  goal_id: z.uuid().optional(),
  destination_account_id: z.uuid().optional(),
  allowance_member: z.string().trim().min(1).optional(),
})

export const updateBudgetLineInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  group: z.enum(BUDGET_GROUPS).optional(),
  amount_cents: centsSchema.optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  interval_count: intervalSchema.optional(),
  management_url: managementUrlSchema.nullable().optional(),
  goal_id: z.uuid().nullable().optional(),
  destination_account_id: z.uuid().nullable().optional(),
  allowance_member: z.string().trim().min(1).nullable().optional(),
})

export const deleteBudgetLineInput = z.object({ id: z.uuid() })

const hasInterval = (frequency: string) =>
  frequency === 'every_n_weeks' || frequency === 'every_n_months'

/** The count the database holds for `frequency`: required for `every_n_*`, null for every fixed one. */
export function intervalFor(frequency: string, count: number | null | undefined): number | null {
  if (!hasInterval(frequency)) {
    if (count !== undefined && count !== null) {
      throw new ToolError(
        'invalid_details',
        'interval_count applies only to every_n_weeks and every_n_months.',
      )
    }
    return null
  }
  if (count === undefined || count === null) {
    throw new ToolError('invalid_details', `${frequency} needs an interval_count.`)
  }
  return count
}

type Group = (typeof BUDGET_GROUPS)[number]

const linksGoal = (group: Group) => group === 'savings' || group === 'investments'

interface Links {
  goal_id: string | null
  destination_account_id: string | null
  allowance_member_id: string | null
}

/**
 * The goal, funding account, and allowance a line ends up with. A field left
 * undefined keeps `current`, except that a group which cannot carry one clears
 * it (Savings/Investments route through their goal, only Discretionary draws
 * from an allowance, and a drawn line is funded by the allowance). Fields the
 * group cannot carry are refused when given explicitly.
 */
async function resolveLinks(
  ctx: NestContext,
  group: Group,
  current: Links,
  input: {
    goal_id?: string | null | undefined
    destination_account_id?: string | null | undefined
    allowance_member?: string | null | undefined
  },
): Promise<Links> {
  let goal = input.goal_id === undefined ? current.goal_id : input.goal_id
  let destination =
    input.destination_account_id === undefined
      ? current.destination_account_id
      : input.destination_account_id
  let allowance: string | null
  if (input.allowance_member === undefined) {
    allowance = current.allowance_member_id
  } else if (input.allowance_member === null) {
    allowance = null
  } else {
    const member = await resolveMember(ctx, input.allowance_member)
    if (member.id !== ctx.memberId) {
      throw new ToolError('invalid_details', 'A line can be drawn only from your own allowance.')
    }
    allowance = member.id
  }

  if (input.goal_id && !linksGoal(group)) {
    throw new ToolError('invalid_details', 'Only savings and investments lines can fund a goal.')
  }
  if (input.destination_account_id && linksGoal(group)) {
    throw new ToolError(
      'invalid_details',
      'Savings and investments lines are funded through their goal, not an account.',
    )
  }
  if (input.allowance_member && group !== 'discretionary') {
    throw new ToolError(
      'invalid_details',
      'Only discretionary lines can be drawn from an allowance.',
    )
  }
  if (input.allowance_member && input.destination_account_id) {
    throw new ToolError(
      'invalid_details',
      'A line drawn from an allowance is funded by it, not by an account of its own.',
    )
  }

  if (!linksGoal(group)) goal = null
  else destination = null
  if (group !== 'discretionary') allowance = null
  if (allowance !== null) destination = null

  if (goal !== null && goal !== current.goal_id) {
    const found = await selectAll<{ id: string }>(ctx, 'savings_goal', { id: goal })
    if (found.length === 0) throw new ToolError('not_found', 'No savings goal matches that id.')
  }
  if (destination !== null && destination !== current.destination_account_id) {
    await requireAccount(ctx, destination)
  }
  return { goal_id: goal, destination_account_id: destination, allowance_member_id: allowance }
}

/** Adds a manual budget line to the household. */
export async function addBudgetLine(ctx: NestContext, input: z.infer<typeof addBudgetLineInput>) {
  const intervalCount = intervalFor(input.frequency, input.interval_count)
  const managementUrl =
    input.management_url === undefined ? null : normaliseManagementUrl(input.management_url)
  const links = await resolveLinks(
    ctx,
    input.group,
    { goal_id: null, destination_account_id: null, allowance_member_id: null },
    input,
  )
  const { data, error } = await ctx.supabase
    .from('budget_line')
    .insert({
      household_id: ctx.householdId,
      name: input.name,
      line_group: input.group,
      amount_cents: input.amount_cents,
      frequency: input.frequency,
      interval_count: intervalCount,
      management_url: managementUrl,
      ...links,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw writeError(error)
  }
  return {
    id: (data as { id: string }).id,
    name: input.name,
    group: input.group,
    amount_cents: input.amount_cents,
    frequency: input.frequency,
    interval_count: intervalCount,
    management_url: managementUrl,
    ...links,
  }
}

interface ExistingLine {
  id: string
  name: string
  line_group: (typeof BUDGET_GROUPS)[number]
  amount_cents: number
  frequency: string
  interval_count: number | null
  management_url: string | null
  breakdown_id: string | null
  is_gift_line: boolean
  goal_id: string | null
  destination_account_id: string | null
  allowance_member_id: string | null
}

/**
 * Edits a manual budget line, changing only the fields given. A line derived
 * from a breakdown or gifts takes its figures from its roll-up and is refused.
 */
export async function updateBudgetLine(
  ctx: NestContext,
  input: z.infer<typeof updateBudgetLineInput>,
) {
  const { data: found, error: readError } = await ctx.supabase
    .from('budget_line')
    .select('*')
    .eq('id', input.id)
    .maybeSingle()
  if (readError) {
    throw fixedError('query_failed')
  }
  const line = found as ExistingLine | null
  if (!line) {
    throw new ToolError('not_found', 'No budget line matches that id.')
  }
  if (line.breakdown_id !== null || line.is_gift_line) {
    throw new ToolError(
      'derived_line',
      'This line is derived from a breakdown or gifts; edit it there.',
    )
  }

  const frequency = input.frequency ?? line.frequency
  const intervalCount = intervalFor(
    frequency,
    input.frequency === undefined && input.interval_count === undefined
      ? line.interval_count
      : input.interval_count,
  )
  const managementUrl =
    input.management_url === undefined
      ? line.management_url
      : input.management_url === null
        ? null
        : normaliseManagementUrl(input.management_url)
  const group = input.group ?? line.line_group
  const links = await resolveLinks(
    ctx,
    group,
    {
      goal_id: line.goal_id,
      destination_account_id: line.destination_account_id,
      allowance_member_id: line.allowance_member_id,
    },
    input,
  )
  const next = {
    name: input.name ?? line.name,
    line_group: group,
    amount_cents: input.amount_cents ?? line.amount_cents,
    frequency,
    interval_count: intervalCount,
    management_url: managementUrl,
    ...links,
  }

  const { data, error } = await ctx.supabase
    .from('budget_line')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw writeError(error)
  }
  return { id: input.id, ...next }
}

/**
 * Deletes a manual budget line. A line derived from a breakdown or gifts is
 * owned by its roll-up and is refused.
 */
export async function deleteBudgetLine(
  ctx: NestContext,
  input: z.infer<typeof deleteBudgetLineInput>,
) {
  const { data, error } = await ctx.supabase
    .from('budget_line')
    .select('*')
    .eq('id', input.id)
    .maybeSingle()
  if (error) {
    throw fixedError('query_failed')
  }
  const line = data as ExistingLine | null
  if (!line) {
    throw new ToolError('not_found', 'No budget line matches that id.')
  }
  if (line.breakdown_id !== null || line.is_gift_line) {
    throw new ToolError(
      'derived_line',
      'This line is derived from a breakdown or gifts; remove it there.',
    )
  }
  return deleteById(ctx, 'budget_line', input.id, 'budget line')
}
