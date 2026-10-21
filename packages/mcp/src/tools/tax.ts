import { z } from 'zod'
import { estimateHouseholdTaxFromRows, type TaxEstimateRows, type TradeRow } from '@nest/household'
import { configsByYear } from '@nest/tax'
import { listMembers, resolveMember, selectAll, type NestContext } from '../context.ts'
import { fixedError } from '../errors.ts'
import { financialYearOrCurrent, financialYearSchema, invalid } from './incomeShared.ts'
import { centsSchema } from './write.ts'

const RESIDENCIES = ['resident', 'foreign_resident'] as const

export const listTaxProfilesInput = z.object({ financial_year: financialYearSchema.optional() })

export const setTaxProfileInput = z.object({
  member: z.string().trim().min(1).optional(),
  financial_year: financialYearSchema.optional(),
  residency: z.enum(RESIDENCIES).optional(),
  has_private_hospital_cover: z.boolean().optional(),
})

export const setHelpDebtInput = z.object({
  member: z.string().trim().min(1).optional(),
  balance_cents: centsSchema,
})

export const getTaxEstimateInput = z.object({ financial_year: financialYearSchema.optional() })

interface TaxProfileRecord {
  id: string
  member_id: string
  financial_year: number
  residency: (typeof RESIDENCIES)[number]
  has_private_hospital_cover: boolean
}

interface HelpDebtRecord {
  member_id: string
  balance_cents: number
}

interface MemberRecord {
  id: string
  name: string
  date_of_birth: string | null
}

/** Each member's tax profile for the financial year (current by default), with their date of birth. */
export async function listTaxProfiles(
  ctx: NestContext,
  input: z.infer<typeof listTaxProfilesInput>,
) {
  const financialYear = financialYearOrCurrent(ctx, input.financial_year)
  const [members, profiles] = await Promise.all([
    selectAll<MemberRecord>(ctx, 'members'),
    selectAll<TaxProfileRecord>(ctx, 'tax_profile', { financial_year: financialYear }),
  ])
  return {
    financial_year: financialYear,
    members: members
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((member) => {
        const profile = profiles.find((candidate) => candidate.member_id === member.id)
        return {
          member_id: member.id,
          member: member.name,
          date_of_birth: member.date_of_birth,
          residency: profile?.residency ?? null,
          has_private_hospital_cover: profile?.has_private_hospital_cover ?? null,
        }
      }),
  }
}

/**
 * Sets a member's tax profile for the financial year, creating it as a resident
 * without private hospital cover where none exists. Only the fields given change.
 */
export async function setTaxProfile(ctx: NestContext, input: z.infer<typeof setTaxProfileInput>) {
  const member = await resolveMember(ctx, input.member)
  const financialYear = financialYearOrCurrent(ctx, input.financial_year)
  const existing = (
    await selectAll<TaxProfileRecord>(ctx, 'tax_profile', {
      member_id: member.id,
      financial_year: financialYear,
    })
  )[0]
  const row = {
    household_id: ctx.householdId,
    member_id: member.id,
    financial_year: financialYear,
    residency: input.residency ?? existing?.residency ?? 'resident',
    has_private_hospital_cover:
      input.has_private_hospital_cover ?? existing?.has_private_hospital_cover ?? false,
  }
  const { error } = await ctx.supabase
    .from('tax_profile')
    .upsert(row, { onConflict: 'member_id,financial_year' })
  if (error) {
    throw fixedError('save_failed')
  }
  return {
    member_id: member.id,
    member: member.name,
    financial_year: financialYear,
    residency: row.residency,
    has_private_hospital_cover: row.has_private_hospital_cover,
  }
}

/** Each member's standing HELP/HECS balance in cents (zero where none is recorded). */
export async function listHelpDebts(ctx: NestContext) {
  const [members, debts] = await Promise.all([
    listMembers(ctx),
    selectAll<HelpDebtRecord>(ctx, 'help_debt'),
  ])
  return {
    help_debts: members
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((member) => ({
        member_id: member.id,
        member: member.name,
        balance_cents: debts.find((debt) => debt.member_id === member.id)?.balance_cents ?? 0,
      })),
  }
}

/** Sets a member's standing HELP/HECS balance, which is not scoped to a financial year. */
export async function setHelpDebt(ctx: NestContext, input: z.infer<typeof setHelpDebtInput>) {
  const member = await resolveMember(ctx, input.member)
  const { error } = await ctx.supabase.from('help_debt').upsert(
    {
      household_id: ctx.householdId,
      member_id: member.id,
      balance_cents: input.balance_cents,
    },
    { onConflict: 'member_id' },
  )
  if (error) {
    throw fixedError('save_failed')
  }
  return { member_id: member.id, member: member.name, balance_cents: input.balance_cents }
}

/**
 * The household's estimated tax for a financial year (current by default), from
 * the same `estimateHouseholdTaxFromRows` the Tax tab runs, over rows read under
 * the member's own row-level security. It counts inflows, tax profiles, HELP
 * debts, super contributions, deductions, and recorded trades; it does not net
 * payslip withholding or add savings-goal interest.
 */
export async function getTaxEstimate(ctx: NestContext, input: z.infer<typeof getTaxEstimateInput>) {
  const financialYear = financialYearOrCurrent(ctx, input.financial_year)
  const config = configsByYear[financialYear]
  if (!config) {
    throw invalid('No tax configuration is published for that financial year.')
  }
  const scoped = { financial_year: financialYear }
  const [inflows, taxProfiles, contributions, helpDebts, deductions, members, trades] =
    await Promise.all([
      selectAll<TaxEstimateRows['inflows'][number]>(ctx, 'inflows'),
      selectAll<TaxEstimateRows['taxProfiles'][number]>(ctx, 'tax_profile', scoped),
      selectAll<TaxEstimateRows['contributions'][number]>(ctx, 'super_contribution', scoped),
      selectAll<TaxEstimateRows['helpDebts'][number]>(ctx, 'help_debt'),
      selectAll<TaxEstimateRows['deductions'][number]>(ctx, 'deduction', scoped),
      selectAll<MemberRecord>(ctx, 'members'),
      selectAll<TradeRow>(ctx, 'trade'),
    ])
  const estimate = estimateHouseholdTaxFromRows(
    inflows,
    taxProfiles,
    contributions,
    helpDebts,
    deductions,
    config,
    undefined,
    members,
    [],
    trades,
  )
  const nameById = new Map(members.map((member) => [member.id, member.name]))
  return {
    financial_year: financialYear,
    annual_gross_cents: estimate.annualGrossCents,
    annual_tax_cents: estimate.annualTaxCents,
    annual_after_tax_cents: estimate.annualAfterTaxCents,
    annual_concessional_contributions_cents: estimate.annualConcessionalContributionsCents,
    annual_deductions_cents: estimate.annualDeductionsCents,
    annual_one_off_gross_cents: estimate.annualOneOffGrossCents,
    annual_one_off_after_tax_cents: estimate.annualOneOffAfterTaxCents,
    annual_net_capital_gain_cents: estimate.annualNetCapitalGainCents,
    fortnightly_gross_cents: estimate.fortnightlyGrossCents,
    fortnightly_tax_cents: estimate.fortnightlyTaxCents,
    fortnightly_after_tax_cents: estimate.fortnightlyAfterTaxCents,
    members: estimate.members.map((member) => ({
      member_id: member.memberId,
      member: nameById.get(member.memberId) ?? null,
      annual_gross_cents: member.annualGrossCents,
      annual_deductions_cents: member.annualDeductionsCents,
      annual_concessional_contributions_cents: member.annualConcessionalContributionsCents,
      taxable_income_cents: member.breakdown.taxableIncomeCents,
      income_tax_cents: member.breakdown.incomeTaxCents,
      medicare_levy_cents: member.breakdown.medicareLevyCents,
      medicare_levy_surcharge_cents: member.breakdown.medicareLevySurchargeCents,
      help_repayment_cents: member.breakdown.helpRepaymentCents,
      division_293_cents: member.breakdown.division293Cents,
      annual_tax_cents: member.annualTaxCents,
      annual_after_tax_cents: member.annualAfterTaxCents,
      annual_one_off_gross_cents: member.annualOneOffGrossCents,
      annual_net_capital_gain_cents: member.annualNetCapitalGainCents,
      fortnightly_after_tax_cents: member.fortnightlyAfterTaxCents,
    })),
  }
}
