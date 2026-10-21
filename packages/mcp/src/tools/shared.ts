import { selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'

interface AccountRef {
  id: string
  type: string
  source: string
}

/** Confirms `id` names an account the member can see, as a funding destination. */
export async function requireAccount(ctx: NestContext, id: string): Promise<void> {
  const rows = await selectAll<AccountRef>(ctx, 'account_directory', { id })
  if (rows.length === 0) {
    throw new ToolError('invalid_account', 'No account matches that id.')
  }
}

/** Confirms `id` names a synced saver (`type = 'savings'`, not manual) the member can see. */
export async function requireSaver(ctx: NestContext, id: string): Promise<void> {
  const rows = await selectAll<AccountRef>(ctx, 'accounts_with_balance', { id })
  const [account] = rows
  if (!account || account.type !== 'savings' || account.source === 'manual') {
    throw new ToolError('invalid_account', 'A goal can link only to a synced savings account.')
  }
}

/** Deletes one household row by id, reporting `what` when no such row is visible. */
export async function deleteById(
  ctx: NestContext,
  table: string,
  id: string,
  what: string,
): Promise<{ id: string }> {
  const { data, error } = await ctx.supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error) {
    throw fixedError('delete_failed')
  }
  if (!data || data.length === 0) {
    throw new ToolError('not_found', `No ${what} matches that id.`)
  }
  return { id }
}
