import { z } from 'zod'
import type { Frequency } from '@nest/plan'
import type { NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import { centsSchema } from './write.ts'

export const BUDGET_GROUPS = ['needs', 'wants', 'discretionary', 'savings', 'investments'] as const

const FREQUENCIES = [
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

const intervalSchema = z.number().int().min(1).max(1_000)

export const addBudgetLineInput = z.object({
  name: z.string().trim().min(1),
  group: z.enum(BUDGET_GROUPS),
  amount_cents: centsSchema,
  frequency: z.enum(FREQUENCIES),
  interval_count: intervalSchema.optional(),
  management_url: managementUrlSchema.optional(),
})

export const updateBudgetLineInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).optional(),
  group: z.enum(BUDGET_GROUPS).optional(),
  amount_cents: centsSchema.optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  interval_count: intervalSchema.optional(),
  management_url: managementUrlSchema.nullable().optional(),
})

const hasInterval = (frequency: string) =>
  frequency === 'every_n_weeks' || frequency === 'every_n_months'

/** The count the database holds for `frequency`: required for `every_n_*`, null for every fixed one. */
function intervalFor(frequency: string, count: number | null | undefined): number | null {
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

/** Adds a manual budget line to the household. */
export async function addBudgetLine(ctx: NestContext, input: z.infer<typeof addBudgetLineInput>) {
  const intervalCount = intervalFor(input.frequency, input.interval_count)
  const managementUrl =
    input.management_url === undefined ? null : normaliseManagementUrl(input.management_url)
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
    })
    .select('id')
    .single()
  if (error || !data) {
    throw fixedError('save_failed')
  }
  return {
    id: (data as { id: string }).id,
    name: input.name,
    group: input.group,
    amount_cents: input.amount_cents,
    frequency: input.frequency,
    interval_count: intervalCount,
    management_url: managementUrl,
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
  const next = {
    name: input.name ?? line.name,
    line_group: input.group ?? line.line_group,
    amount_cents: input.amount_cents ?? line.amount_cents,
    frequency,
    interval_count: intervalCount,
    management_url: managementUrl,
  }

  const { data, error } = await ctx.supabase
    .from('budget_line')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw fixedError('save_failed')
  }
  return { id: input.id, ...next }
}
