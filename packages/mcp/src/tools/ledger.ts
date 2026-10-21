import { z } from 'zod'
import { selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'

interface DirectoryRow {
  id: string
  name: string
  type: string
  source: string
  owner_member_id: string | null
  deleted_from_source_at: string | null
}

interface BalanceRow extends DirectoryRow {
  balance_cents: number
  exclude_from_net_worth: boolean
}

interface MemberRow {
  id: string
  name: string
  date_of_birth: string | null
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

/**
 * Every account the member can see. An account whose balance the member may
 * read (shared, their own, or a household super account) carries it; a
 * co-member's spending account appears by name only, with a null balance and
 * `balance_visible: false`. A co-member's savers do not appear at all.
 */
export async function listAccounts(ctx: NestContext) {
  const [withBalance, directory, members] = await Promise.all([
    selectAll<BalanceRow>(ctx, 'accounts_with_balance'),
    selectAll<DirectoryRow>(ctx, 'account_directory'),
    selectAll<MemberRow>(ctx, 'members'),
  ])
  const ownerName = (id: string | null) =>
    id === null ? null : (members.find((member) => member.id === id)?.name ?? null)
  const shape = (row: DirectoryRow, balance: BalanceRow | undefined) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    source: row.source,
    owner: ownerName(row.owner_member_id),
    deleted_from_source: row.deleted_from_source_at !== null,
    balance_visible: balance !== undefined,
    balance_cents: balance?.balance_cents ?? null,
    exclude_from_net_worth: balance?.exclude_from_net_worth ?? null,
  })
  const accounts = withBalance.map((row) => shape(row, row))
  const seen = new Set(withBalance.map((row) => row.id))
  for (const row of directory) {
    if (!seen.has(row.id)) accounts.push(shape(row, undefined))
  }
  accounts.sort((a, b) => a.name.localeCompare(b.name))
  return { accounts }
}

/** Resolves an account the member can see by id or case-insensitive name. */
async function findAccount(ctx: NestContext, reference: string): Promise<DirectoryRow> {
  const [directory, withBalance] = await Promise.all([
    selectAll<DirectoryRow>(ctx, 'account_directory'),
    selectAll<DirectoryRow>(ctx, 'accounts_with_balance'),
  ])
  const rows = [...directory, ...withBalance.filter((a) => !directory.some((d) => d.id === a.id))]
  const wanted = reference.trim().toLowerCase()
  const byId = rows.find((row) => row.id.toLowerCase() === wanted)
  if (byId) return byId
  const named = rows.filter((row) => row.name.trim().toLowerCase() === wanted)
  if (named.length > 1) {
    throw new ToolError(
      'invalid_details',
      `More than one account is named "${reference}"; use its id.`,
    )
  }
  const [match] = named
  if (!match) throw new ToolError('not_found', `No account matches "${reference}".`)
  return match
}

export const setNetWorthExclusionInput = z.object({
  account: z.string().trim().min(1),
  excluded: z.boolean(),
})

/**
 * Sets the household-wide flag that leaves an account out of net-worth totals
 * (not retirement projection or budgeting), shared by both partners.
 */
export async function setAccountNetWorthExclusion(
  ctx: NestContext,
  input: z.infer<typeof setNetWorthExclusionInput>,
) {
  const account = await findAccount(ctx, input.account)
  const { data, error } = await ctx.supabase
    .from('accounts')
    .update({ exclude_from_net_worth: input.excluded })
    .eq('id', account.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw fixedError('save_failed')
  }
  return { id: account.id, name: account.name, exclude_from_net_worth: input.excluded }
}

/** The household's members: id, name, and date of birth where one is recorded. */
export async function listMembers(ctx: NestContext) {
  const rows = await selectAll<MemberRow>(ctx, 'members')
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return {
    members: rows.map((row) => ({
      id: row.id,
      name: row.name,
      date_of_birth: row.date_of_birth,
      is_you: row.id === ctx.memberId,
    })),
  }
}

export const setMemberDateOfBirthInput = z.object({
  member: z.string().trim().min(1),
  date_of_birth: isoDate.nullable(),
})

/** Records (or, with null, clears) any household member's date of birth. */
export async function setMemberDateOfBirth(
  ctx: NestContext,
  input: z.infer<typeof setMemberDateOfBirthInput>,
) {
  const wanted = input.member.trim().toLowerCase()
  const rows = await selectAll<MemberRow>(ctx, 'members')
  const match = rows.find(
    (row) => row.id.toLowerCase() === wanted || row.name.trim().toLowerCase() === wanted,
  )
  if (!match) throw new ToolError('not_found', `No household member matches "${input.member}".`)
  const date = input.date_of_birth
  if (
    date !== null &&
    (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
      date > ctx.now().toISOString().slice(0, 10))
  ) {
    throw new ToolError(
      'invalid_details',
      'date_of_birth must be a real date that is not in the future.',
    )
  }
  const { error } = await ctx.supabase.rpc('set_member_date_of_birth', {
    p_member_id: match.id,
    p_date_of_birth: date,
  })
  if (error) throw fixedError('save_failed')
  return { id: match.id, name: match.name, date_of_birth: date }
}

interface HouseholdRow {
  id: string
  name: string
  timezone: string
  pay_account_id: string | null
}

/** The household's name, timezone, and the account its pay lands in. */
export async function getHousehold(ctx: NestContext) {
  const [household] = await selectAll<HouseholdRow>(ctx, 'households', { id: ctx.householdId })
  if (!household) throw new ToolError('not_found', 'The household could not be found.')
  let payAccount: { id: string; name: string } | null = null
  if (household.pay_account_id !== null) {
    const accounts = await selectAll<DirectoryRow>(ctx, 'account_directory')
    const found = accounts.find((account) => account.id === household.pay_account_id)
    payAccount = found
      ? { id: found.id, name: found.name }
      : { id: household.pay_account_id, name: '' }
  }
  return {
    id: household.id,
    name: household.name,
    timezone: household.timezone,
    pay_account: payAccount,
  }
}

export const setPayAccountInput = z.object({ account: z.string().trim().min(1).nullable() })

/** Designates (or, with null, clears) the household's pay account. */
export async function setPayAccount(ctx: NestContext, input: z.infer<typeof setPayAccountInput>) {
  const account = input.account === null ? null : await findAccount(ctx, input.account)
  const { error } = await ctx.supabase.rpc('set_household_pay_account', {
    p_account_id: account?.id ?? null,
  })
  if (error) throw fixedError('save_failed')
  return { pay_account: account ? { id: account.id, name: account.name } : null }
}

interface CategoryRow {
  id: string
  name: string
  kind: string
  parent_id: string | null
  is_archived: boolean
}

export const listCategoriesInput = z.object({ include_archived: z.boolean().optional() })

/** The household's income and expense categories, with each one's parent. */
export async function listCategories(ctx: NestContext, input: z.infer<typeof listCategoriesInput>) {
  const rows = await selectAll<CategoryRow>(ctx, 'categories')
  const categories = rows
    .filter((row) => input.include_archived === true || !row.is_archived)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    .map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      parent_id: row.parent_id,
      archived: row.is_archived,
    }))
  return { categories }
}

interface TransactionRow {
  id: string
  account_id: string
  member_id: string | null
  category_id: string | null
  posted_at: string
  amount_cents: number
  description: string
  kind: string
  status: string
  external_category: string | null
}

const MAX_TRANSACTIONS = 200

export const listTransactionsInput = z.object({
  account: z.string().trim().min(1).optional(),
  kind: z.enum(['income', 'expense', 'transfer']).optional(),
  external_category: z.string().trim().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.number().int().min(1).max(MAX_TRANSACTIONS).optional(),
})

/**
 * Ledger transactions the member's row-level security exposes (a co-member's
 * spending account is hidden, as is a gift already claimed for them), newest
 * first. `external_category` narrows to a source category such as Up's
 * `gifts-and-charity`. `amount_cents` is signed: negative is an outflow.
 */
export async function listTransactions(
  ctx: NestContext,
  input: z.infer<typeof listTransactionsInput>,
) {
  const filters: Record<string, string> = {}
  if (input.account !== undefined) filters.account_id = (await findAccount(ctx, input.account)).id
  if (input.kind !== undefined) filters.kind = input.kind
  if (input.external_category !== undefined) filters.external_category = input.external_category
  const rows = await selectAll<TransactionRow>(ctx, 'transactions', filters)
  const matching = rows
    .filter((row) => {
      const day = row.posted_at.slice(0, 10)
      return (
        (input.from === undefined || day >= input.from) &&
        (input.to === undefined || day <= input.to)
      )
    })
    .sort((a, b) => b.posted_at.localeCompare(a.posted_at))
  return {
    total: matching.length,
    transactions: matching.slice(0, input.limit ?? 50).map((row) => ({
      id: row.id,
      account_id: row.account_id,
      member_id: row.member_id,
      category_id: row.category_id,
      posted_at: row.posted_at,
      amount_cents: row.amount_cents,
      description: row.description,
      kind: row.kind,
      status: row.status,
      external_category: row.external_category,
    })),
  }
}
