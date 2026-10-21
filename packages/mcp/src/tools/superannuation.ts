import { z } from 'zod'
import { listMembers, resolveMember, selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import {
  deleteRow,
  financialYearOrCurrent,
  financialYearSchema,
  findRow,
  frequencySchema,
  insertRow,
  intervalCountSchema,
  intervalFor,
  invalid,
  updateRow,
} from './incomeShared.ts'
import { centsSchema } from './write.ts'

const KINDS = [
  'salary_sacrifice',
  'personal_deductible',
  'personal_non_concessional',
  'spouse',
] as const
const MODES = ['amount', 'percent'] as const

type Kind = (typeof KINDS)[number]
type Mode = (typeof MODES)[number]

const percentBpSchema = z.number().int().min(0).max(10_000)
const yearInput = { financial_year: financialYearSchema.optional() }

export const listSuperInput = z.object(yearInput)

export const setSuperProfileInput = z.object({
  member: z.string().trim().min(1).optional(),
  ...yearInput,
  fund_name: z.string().trim().nullable().optional(),
  balance_cents: centsSchema,
})

export const listSuperContributionsInput = z.object({
  member: z.string().trim().min(1).optional(),
  ...yearInput,
})

export const addSuperContributionInput = z.object({
  member: z.string().trim().min(1).optional(),
  ...yearInput,
  kind: z.enum(KINDS),
  mode: z.enum(MODES),
  amount_cents: centsSchema.optional(),
  percent_bp: percentBpSchema.optional(),
  frequency: frequencySchema,
  interval_count: intervalCountSchema.optional(),
  fhss_eligible: z.boolean().optional(),
  contributor: z.string().trim().min(1).optional(),
})

export const updateSuperContributionInput = z.object({
  id: z.uuid(),
  kind: z.enum(KINDS).optional(),
  mode: z.enum(MODES).optional(),
  amount_cents: centsSchema.optional(),
  percent_bp: percentBpSchema.optional(),
  frequency: frequencySchema.optional(),
  interval_count: intervalCountSchema.optional(),
  fhss_eligible: z.boolean().optional(),
  contributor: z.string().trim().min(1).optional(),
})

export const deleteSuperContributionInput = z.object({ id: z.uuid() })

interface SuperProfileRecord {
  member_id: string
  financial_year: number
  fund_name: string | null
  linked_account_id: string | null
  balance_as_of: string | null
  carry_forward_cap_cents: number
  sg_rate_override: number | null
}

interface AccountRecord {
  id: string
  balance_cents: number | null
}

interface ContributionRecord {
  id: string
  member_id: string
  financial_year: number
  kind: Kind
  mode: Mode
  amount_cents: number | null
  percent_bp: number | null
  frequency: string
  interval_count: number | null
  fhss_eligible: boolean
  contributor_member_id: string | null
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

/** Each member's super profile for the financial year (current by default) with the linked account's balance. */
export async function listSuperProfiles(ctx: NestContext, input: z.infer<typeof listSuperInput>) {
  const financialYear = financialYearOrCurrent(ctx, input.financial_year)
  const [members, profiles, accounts] = await Promise.all([
    listMembers(ctx),
    selectAll<SuperProfileRecord>(ctx, 'super_profile', { financial_year: financialYear }),
    selectAll<AccountRecord>(ctx, 'accounts_with_balance'),
  ])
  const balanceById = new Map(accounts.map((account) => [account.id, account.balance_cents]))
  return {
    financial_year: financialYear,
    profiles: members
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((member) => {
        const profile = profiles.find((candidate) => candidate.member_id === member.id)
        const linked = profile?.linked_account_id ?? null
        return {
          member_id: member.id,
          member: member.name,
          fund_name: profile?.fund_name ?? null,
          linked_account_id: linked,
          balance_cents: linked === null ? null : (balanceById.get(linked) ?? null),
          balance_as_of: profile?.balance_as_of ?? null,
          carry_forward_cap_cents: profile?.carry_forward_cap_cents ?? 0,
          sg_rate_override: profile?.sg_rate_override ?? null,
        }
      }),
  }
}

/**
 * Sets a member's super fund and confirmed balance as of today: the fund name
 * and balance live on the member's linked account (a manual savings account is
 * created and linked where there is none), and the profile records the true-up.
 * Omit `fund_name` to keep the saved one; pass null or empty to clear it.
 */
export async function setSuperProfile(
  ctx: NestContext,
  input: z.infer<typeof setSuperProfileInput>,
) {
  const member = await resolveMember(ctx, input.member)
  const financialYear = financialYearOrCurrent(ctx, input.financial_year)
  const existing = (
    await selectAll<SuperProfileRecord>(ctx, 'super_profile', {
      member_id: member.id,
      financial_year: financialYear,
    })
  )[0]
  const requested = input.fund_name === undefined ? (existing?.fund_name ?? null) : input.fund_name
  const fundName = requested === null || requested === '' ? null : requested
  const accountName = fundName ?? `${member.name} Super`

  let accountId = existing?.linked_account_id ?? null
  if (accountId) {
    await updateRow(
      ctx,
      'accounts',
      accountId,
      { name: accountName },
      'The linked account is gone.',
    )
  } else {
    accountId = await insertRow(ctx, 'accounts', {
      household_id: ctx.householdId,
      source: 'manual',
      type: 'savings',
      owner_member_id: member.id,
      name: accountName,
    })
  }
  const { error: balanceError } = await ctx.supabase.from('account_balance').upsert(
    {
      account_id: accountId,
      household_id: ctx.householdId,
      balance_cents: input.balance_cents,
    },
    { onConflict: 'account_id' },
  )
  if (balanceError) {
    throw fixedError('save_failed')
  }
  const balanceAsOf = isoDate(ctx.now())
  const { error } = await ctx.supabase.from('super_profile').upsert(
    {
      household_id: ctx.householdId,
      member_id: member.id,
      financial_year: financialYear,
      fund_name: fundName,
      linked_account_id: accountId,
      balance_as_of: balanceAsOf,
    },
    { onConflict: 'member_id,financial_year' },
  )
  if (error) {
    throw fixedError('save_failed')
  }
  return {
    member_id: member.id,
    member: member.name,
    financial_year: financialYear,
    fund_name: fundName,
    linked_account_id: accountId,
    balance_cents: input.balance_cents,
    balance_as_of: balanceAsOf,
  }
}

const shapeContribution = (row: ContributionRecord) => ({
  id: row.id,
  member_id: row.member_id,
  financial_year: row.financial_year,
  kind: row.kind,
  mode: row.mode,
  amount_cents: row.amount_cents,
  percent_bp: row.percent_bp,
  frequency: row.frequency,
  interval_count: row.interval_count,
  fhss_eligible: row.fhss_eligible,
  contributor_member_id: row.contributor_member_id,
})

/** A financial year's super contributions (current year by default), optionally for one member. */
export async function listSuperContributions(
  ctx: NestContext,
  input: z.infer<typeof listSuperContributionsInput>,
) {
  const financialYear = financialYearOrCurrent(ctx, input.financial_year)
  const [rows, members] = await Promise.all([
    selectAll<ContributionRecord>(ctx, 'super_contribution', { financial_year: financialYear }),
    listMembers(ctx),
  ])
  const wanted = input.member === undefined ? null : (await resolveMember(ctx, input.member)).id
  const nameById = new Map(members.map((member) => [member.id, member.name]))
  return {
    financial_year: financialYear,
    contributions: rows
      .filter((row) => wanted === null || row.member_id === wanted)
      .map((row) => ({
        ...shapeContribution(row),
        member: nameById.get(row.member_id) ?? null,
        contributor: row.contributor_member_id
          ? (nameById.get(row.contributor_member_id) ?? null)
          : null,
      })),
  }
}

type ContributionWrite = Omit<ContributionRecord, 'id'>

/** Holds a contribution to the database's `super_contribution_*` checks and the PWA form's rules. */
async function resolveContribution(
  ctx: NestContext,
  existing: ContributionRecord | null,
  base: Pick<ContributionWrite, 'member_id' | 'financial_year'>,
  input: Omit<z.infer<typeof updateSuperContributionInput>, 'id'>,
): Promise<ContributionWrite> {
  const kind = input.kind ?? existing?.kind
  const mode = input.mode ?? existing?.mode
  const frequency = input.frequency ?? existing?.frequency
  if (!kind || !mode || !frequency) {
    throw invalid('A contribution needs a kind, mode, and frequency.')
  }

  const sameMode = existing?.mode === mode
  let amount: number | null = null
  let percentBp: number | null = null
  if (mode === 'amount') {
    if (input.percent_bp !== undefined) throw invalid('percent_bp applies only to percent mode.')
    amount = input.amount_cents ?? (sameMode ? (existing?.amount_cents ?? null) : null)
    if (amount === null) throw invalid('Amount mode needs amount_cents.')
  } else {
    if (input.amount_cents !== undefined) throw invalid('amount_cents applies only to amount mode.')
    percentBp = input.percent_bp ?? (sameMode ? (existing?.percent_bp ?? null) : null)
    if (percentBp === null) throw invalid('Percent mode needs percent_bp (basis points of salary).')
  }

  const intervalCount = intervalFor(
    frequency,
    input.frequency === undefined
      ? (input.interval_count ?? existing?.interval_count)
      : input.interval_count,
  )

  let contributorId: string | null = null
  if (kind === 'spouse') {
    contributorId =
      input.contributor !== undefined
        ? (await resolveMember(ctx, input.contributor)).id
        : (existing?.contributor_member_id ?? null)
    if (contributorId === null) throw invalid('A spouse contribution needs a contributor.')
    if (contributorId === base.member_id) {
      throw invalid('The contributor of a spouse contribution is the other member.')
    }
  } else if (input.contributor !== undefined) {
    throw invalid('contributor applies only to a spouse contribution.')
  }

  return {
    ...base,
    kind,
    mode,
    amount_cents: amount,
    percent_bp: percentBp,
    frequency,
    interval_count: intervalCount,
    fhss_eligible: input.fhss_eligible ?? existing?.fhss_eligible ?? false,
    contributor_member_id: contributorId,
  }
}

/** Adds a super contribution for a member in a financial year (current by default). */
export async function addSuperContribution(
  ctx: NestContext,
  input: z.infer<typeof addSuperContributionInput>,
) {
  const member = await resolveMember(ctx, input.member)
  const { member: _member, financial_year, ...rest } = input
  const row = await resolveContribution(
    ctx,
    null,
    { member_id: member.id, financial_year: financialYearOrCurrent(ctx, financial_year) },
    rest,
  )
  const id = await insertRow(ctx, 'super_contribution', { household_id: ctx.householdId, ...row })
  return { id, member: member.name, ...row }
}

/** Edits a super contribution, changing only the fields given. */
export async function updateSuperContribution(
  ctx: NestContext,
  input: z.infer<typeof updateSuperContributionInput>,
) {
  const existing = await findRow<ContributionRecord>(ctx, 'super_contribution', input.id)
  if (!existing) {
    throw new ToolError('not_found', 'No super contribution matches that id.')
  }
  const { id, ...changes } = input
  const row = await resolveContribution(
    ctx,
    existing,
    { member_id: existing.member_id, financial_year: existing.financial_year },
    changes,
  )
  await updateRow(ctx, 'super_contribution', id, row, 'No super contribution matches that id.')
  return { id, ...row }
}

/** Deletes a super contribution. */
export function deleteSuperContribution(
  ctx: NestContext,
  input: z.infer<typeof deleteSuperContributionInput>,
) {
  return deleteRow(ctx, 'super_contribution', input.id, 'No super contribution matches that id.')
}
