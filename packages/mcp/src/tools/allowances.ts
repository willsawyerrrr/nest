import { z } from 'zod'
import { annualCents, fortnightlyCents, type Frequency } from '@nest/plan'
import { listMembers, resolveMember, selectAll, type NestContext } from '../context.ts'
import { ToolError, writeError } from '../errors.ts'
import { FREQUENCIES, intervalFor, intervalSchema } from './budgetLines.ts'
import { requireAccount } from './shared.ts'
import { centsSchema } from './write.ts'

export const updateMemberAllowanceInput = z.object({
  member: z.string().trim().min(1).optional(),
  amount_cents: centsSchema.optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  interval_count: intervalSchema.optional(),
  destination_account_id: z.uuid().nullable().optional(),
})

interface AllowanceRow {
  member_id: string
  amount_cents: number
  frequency: Frequency
  interval_count: number | null
  destination_account_id: string | null
}

/** Each member's spending allowance: amount, cadence, and the account that funds it. */
export async function listMemberAllowances(ctx: NestContext) {
  const [rows, members] = await Promise.all([
    selectAll<AllowanceRow>(ctx, 'member_allowance'),
    listMembers(ctx),
  ])
  const allowances = rows
    .map((row) => {
      const interval = row.interval_count ?? undefined
      return {
        member_id: row.member_id,
        member: members.find((member) => member.id === row.member_id)?.name ?? null,
        amount_cents: row.amount_cents,
        frequency: row.frequency,
        interval_count: row.interval_count,
        fortnightly_cents: fortnightlyCents(row.amount_cents, row.frequency, interval),
        annual_cents: annualCents(row.amount_cents, row.frequency, interval),
        destination_account_id: row.destination_account_id,
      }
    })
    .sort((a, b) => (a.member ?? '').localeCompare(b.member ?? ''))
  return { allowances }
}

/**
 * Sets a member's allowance amount, cadence, or funding account, changing only
 * the fields given (the signed-in member's when none is named). The database
 * refuses a change that leaves less than is already drawn from it.
 */
export async function updateMemberAllowance(
  ctx: NestContext,
  input: z.infer<typeof updateMemberAllowanceInput>,
) {
  const member = await resolveMember(ctx, input.member)
  const [existing] = await selectAll<AllowanceRow>(ctx, 'member_allowance', {
    member_id: member.id,
  })
  if (!existing) {
    throw new ToolError('not_found', 'No allowance matches that member.')
  }
  const frequency = input.frequency ?? existing.frequency
  const intervalCount = intervalFor(
    frequency,
    input.frequency === undefined && input.interval_count === undefined
      ? existing.interval_count
      : input.interval_count,
  )
  const destination =
    input.destination_account_id === undefined
      ? existing.destination_account_id
      : input.destination_account_id
  if (destination !== null && destination !== existing.destination_account_id) {
    await requireAccount(ctx, destination)
  }
  const next = {
    amount_cents: input.amount_cents ?? existing.amount_cents,
    frequency,
    interval_count: intervalCount,
    destination_account_id: destination,
  }
  const { data, error } = await ctx.supabase
    .from('member_allowance')
    .update(next)
    .eq('member_id', member.id)
    .eq('household_id', ctx.householdId)
    .select('member_id')
  if (error || !data || data.length === 0) {
    throw writeError(error)
  }
  return { member_id: member.id, member: member.name, ...next }
}
