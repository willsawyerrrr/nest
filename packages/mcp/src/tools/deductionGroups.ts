import { z } from 'zod'
import { financialYearForDate } from '@nest/tax'
import { resolveMember, selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import type { DeductionRow } from './deductions.ts'

const financialYearSchema = z.number().int().min(2000).max(2100)

export interface GroupRow {
  id: string
  member_id: string
  financial_year: number
  name: string
  kind: 'standard' | 'donations'
}

export function automaticGroupError(): ToolError {
  return new ToolError(
    'automatic_group',
    'Donations are filed automatically in a donations group, which cannot be changed or deleted.',
  )
}

export async function findGroup(ctx: NestContext, id: string): Promise<GroupRow> {
  const { data, error } = await ctx.supabase
    .from('deduction_group')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw fixedError('query_failed')
  if (!data) throw new ToolError('not_found', 'No deduction group matches that id.')
  return data as GroupRow
}

export const listDeductionGroupsInput = z.object({
  financial_year: financialYearSchema.optional(),
  member: z.string().trim().min(1).optional(),
})

/** Lists deduction groups with their payment count and summed total, which is never stored. */
export async function listDeductionGroups(
  ctx: NestContext,
  input: z.infer<typeof listDeductionGroupsInput>,
) {
  const financialYear = input.financial_year ?? financialYearForDate(ctx.now())
  const member = input.member === undefined ? null : await resolveMember(ctx, input.member)
  const [groups, deductions, members] = await Promise.all([
    selectAll<GroupRow>(ctx, 'deduction_group', { financial_year: financialYear }),
    selectAll<DeductionRow>(ctx, 'deduction', { financial_year: financialYear }),
    selectAll<{ id: string; name: string }>(ctx, 'members'),
  ])
  return groups
    .filter((group) => member === null || group.member_id === member.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => {
      const payments = deductions.filter((row) => row.group_id === group.id)
      return {
        id: group.id,
        member: members.find((m) => m.id === group.member_id)?.name ?? null,
        name: group.name,
        kind: group.kind,
        financial_year: group.financial_year,
        payments: payments.length,
        total_cents: payments.reduce((total, row) => total + row.amount_cents, 0),
      }
    })
}

export const createDeductionGroupInput = z.object({
  name: z.string().trim().min(1),
  member: z.string().trim().min(1).optional(),
  financial_year: financialYearSchema.optional(),
})

/** Creates a standard deduction group for a member and financial year (default: the current one). */
export async function createDeductionGroup(
  ctx: NestContext,
  input: z.infer<typeof createDeductionGroupInput>,
) {
  const member = await resolveMember(ctx, input.member)
  const financialYear = input.financial_year ?? financialYearForDate(ctx.now())
  const { data, error } = await ctx.supabase
    .from('deduction_group')
    .insert({
      household_id: ctx.householdId,
      member_id: member.id,
      name: input.name,
      financial_year: financialYear,
    })
    .select('id')
    .single()
  if (error || !data) throw fixedError('save_failed')
  return {
    id: (data as { id: string }).id,
    member: member.name,
    name: input.name,
    kind: 'standard' as const,
    financial_year: financialYear,
  }
}

export const updateDeductionGroupInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
})

/** Renames a standard deduction group. */
export async function updateDeductionGroup(
  ctx: NestContext,
  input: z.infer<typeof updateDeductionGroupInput>,
) {
  const group = await findGroup(ctx, input.id)
  if (group.kind === 'donations') throw automaticGroupError()
  const { data, error } = await ctx.supabase
    .from('deduction_group')
    .update({ name: input.name })
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) throw fixedError('save_failed')
  return { id: input.id, name: input.name }
}

export const deleteDeductionGroupInput = z.object({ id: z.uuid() })

/** Deletes a standard deduction group; its payments stay as ungrouped deductions. */
export async function deleteDeductionGroup(
  ctx: NestContext,
  input: z.infer<typeof deleteDeductionGroupInput>,
) {
  const group = await findGroup(ctx, input.id)
  if (group.kind === 'donations') throw automaticGroupError()
  const { error } = await ctx.supabase
    .from('deduction_group')
    .delete()
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
  if (error) throw fixedError('delete_failed')
  return { id: input.id, deleted: true }
}
