import { z } from 'zod'
import { selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import { requireAccount } from './shared.ts'
import { centsSchema } from './write.ts'

export const confirmPaySplitInput = z.object({
  account_id: z.uuid(),
  fortnightly_cents: centsSchema,
})

export const clearPaySplitInput = z.object({ account_id: z.uuid() })

interface SplitRow {
  account_id: string
  confirmed_fortnightly_cents: number
  confirmed_at: string
}

interface AccountRow {
  id: string
  name: string
}

/** The household's pay account and the fortnightly split confirmed as set in Up for each account. */
export async function listPaySplits(ctx: NestContext) {
  const [splits, accounts, households] = await Promise.all([
    selectAll<SplitRow>(ctx, 'pay_split'),
    selectAll<AccountRow>(ctx, 'account_directory'),
    selectAll<{ pay_account_id: string | null }>(ctx, 'households', { id: ctx.householdId }),
  ])
  const nameById = new Map(accounts.map((account) => [account.id, account.name]))
  const payAccountId = households[0]?.pay_account_id ?? null
  return {
    pay_account_id: payAccountId,
    pay_account: payAccountId === null ? null : (nameById.get(payAccountId) ?? null),
    splits: splits
      .map((split) => ({
        account_id: split.account_id,
        account: nameById.get(split.account_id) ?? null,
        confirmed_fortnightly_cents: split.confirmed_fortnightly_cents,
        confirmed_at: split.confirmed_at,
      }))
      .sort((a, b) => (a.account ?? '').localeCompare(b.account ?? '')),
  }
}

/** Records the fortnightly split the household has set in Up for an account. */
export async function confirmPaySplit(
  ctx: NestContext,
  input: z.infer<typeof confirmPaySplitInput>,
) {
  await requireAccount(ctx, input.account_id)
  const confirmedAt = ctx.now().toISOString()
  const { error } = await ctx.supabase.from('pay_split').upsert(
    {
      household_id: ctx.householdId,
      account_id: input.account_id,
      confirmed_fortnightly_cents: input.fortnightly_cents,
      confirmed_at: confirmedAt,
    },
    { onConflict: 'household_id,account_id' },
  )
  if (error) {
    throw fixedError('save_failed')
  }
  return {
    account_id: input.account_id,
    confirmed_fortnightly_cents: input.fortnightly_cents,
    confirmed_at: confirmedAt,
  }
}

/** Clears an account's confirmed split, so the recommendation reads as unconfirmed again. */
export async function clearPaySplit(ctx: NestContext, input: z.infer<typeof clearPaySplitInput>) {
  const { data, error } = await ctx.supabase
    .from('pay_split')
    .delete()
    .eq('account_id', input.account_id)
    .eq('household_id', ctx.householdId)
    .select('account_id')
  if (error) {
    throw fixedError('delete_failed')
  }
  if (!data || data.length === 0) {
    throw new ToolError('not_found', 'No confirmed split matches that account.')
  }
  return { account_id: input.account_id }
}
