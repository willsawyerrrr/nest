import { z } from 'zod'
import { grantValueCents, vestedQuantity, type EquityGrant } from '@nest/plan'
import { listMembers, resolveMember, selectAll, type NestContext } from '../context.ts'
import { ToolError } from '../errors.ts'
import { deleteRow, findRow, insertRow, invalid, updateRow } from './incomeShared.ts'
import { centsSchema, isoDateSchema } from './write.ts'

const INSTRUMENT_TYPES = ['option', 'share'] as const
const VESTING_FREQUENCIES = ['monthly', 'quarterly', 'annual'] as const

const quantitySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const monthsSchema = z.number().int().nonnegative().max(1_200)

export const addEquityGrantInput = z.object({
  member: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1),
  instrument_type: z.enum(INSTRUMENT_TYPES),
  quantity: quantitySchema,
  grant_date: isoDateSchema,
  cliff_months: monthsSchema.optional(),
  vesting_period_months: monthsSchema.positive().optional(),
  vesting_frequency: z.enum(VESTING_FREQUENCIES).optional(),
  strike_price_cents: centsSchema.optional(),
  price_per_share_cents: centsSchema.optional(),
  price_as_of: isoDateSchema.optional(),
})

export const updateEquityGrantInput = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).optional(),
  instrument_type: z.enum(INSTRUMENT_TYPES).optional(),
  quantity: quantitySchema.optional(),
  grant_date: isoDateSchema.optional(),
  cliff_months: monthsSchema.optional(),
  vesting_period_months: monthsSchema.positive().optional(),
  vesting_frequency: z.enum(VESTING_FREQUENCIES).optional(),
  strike_price_cents: centsSchema.nullable().optional(),
  price_per_share_cents: centsSchema.optional(),
  price_as_of: isoDateSchema.nullable().optional(),
})

export const deleteEquityGrantInput = z.object({ id: z.uuid() })

interface EquityGrantRecord {
  id: string
  member_id: string
  label: string
  instrument_type: (typeof INSTRUMENT_TYPES)[number]
  quantity: number
  grant_date: string
  cliff_months: number
  vesting_period_months: number
  vesting_frequency: (typeof VESTING_FREQUENCIES)[number]
  strike_price_cents: number | null
  price_per_share_cents: number
  price_as_of: string | null
}

const toEngine = (grant: EquityGrantRecord): EquityGrant => ({
  quantity: grant.quantity,
  grantDate: grant.grant_date,
  cliffMonths: grant.cliff_months,
  vestingPeriodMonths: grant.vesting_period_months,
  vestingFrequency: grant.vesting_frequency,
  instrumentType: grant.instrument_type,
  strikePriceCents: grant.strike_price_cents,
  pricePerShareCents: grant.price_per_share_cents,
})

/** The columns a grant saves; an option may carry a strike, a share never does. */
type GrantWrite = Omit<EquityGrantRecord, 'id'>

function shape(grant: GrantWrite): GrantWrite {
  return {
    ...grant,
    strike_price_cents: grant.instrument_type === 'option' ? grant.strike_price_cents : null,
  }
}

/** The household's equity grants with the vested quantity and value as of today, in cents. */
export async function listEquityGrants(ctx: NestContext) {
  const [grants, members] = await Promise.all([
    selectAll<EquityGrantRecord>(ctx, 'equity_grant'),
    listMembers(ctx),
  ])
  const nameById = new Map(members.map((member) => [member.id, member.name]))
  const now = ctx.now()
  const shaped = grants
    .sort((a, b) => a.grant_date.localeCompare(b.grant_date) || a.label.localeCompare(b.label))
    .map((grant) => ({
      ...grant,
      member: nameById.get(grant.member_id) ?? null,
      vested_quantity: vestedQuantity(toEngine(grant), now),
      vested_value_cents: grantValueCents(toEngine(grant), now),
    }))
  return {
    grants: shaped,
    total_vested_value_cents: shaped.reduce((sum, grant) => sum + grant.vested_value_cents, 0),
  }
}

/** Adds a startup-equity grant (options or shares) for a member. */
export async function addEquityGrant(ctx: NestContext, input: z.infer<typeof addEquityGrantInput>) {
  const member = await resolveMember(ctx, input.member)
  if (input.instrument_type === 'share' && input.strike_price_cents !== undefined) {
    throw invalid('A share has no strike price.')
  }
  const row = shape({
    member_id: member.id,
    label: input.label,
    instrument_type: input.instrument_type,
    quantity: input.quantity,
    grant_date: input.grant_date,
    cliff_months: input.cliff_months ?? 12,
    vesting_period_months: input.vesting_period_months ?? 48,
    vesting_frequency: input.vesting_frequency ?? 'monthly',
    strike_price_cents: input.strike_price_cents ?? null,
    price_per_share_cents: input.price_per_share_cents ?? 0,
    price_as_of: input.price_as_of ?? null,
  })
  const id = await insertRow(ctx, 'equity_grant', { household_id: ctx.householdId, ...row })
  return { id, member: member.name, ...row }
}

/** Edits an equity grant, changing only the fields given. */
export async function updateEquityGrant(
  ctx: NestContext,
  input: z.infer<typeof updateEquityGrantInput>,
) {
  const existing = await findRow<EquityGrantRecord>(ctx, 'equity_grant', input.id)
  if (!existing) {
    throw new ToolError('not_found', 'No equity grant matches that id.')
  }
  const instrumentType = input.instrument_type ?? existing.instrument_type
  if (instrumentType === 'share' && input.strike_price_cents != null) {
    throw invalid('A share has no strike price.')
  }
  const { id: _id, member_id, ...current } = existing
  const row = shape({
    member_id,
    label: input.label ?? current.label,
    instrument_type: instrumentType,
    quantity: input.quantity ?? current.quantity,
    grant_date: input.grant_date ?? current.grant_date,
    cliff_months: input.cliff_months ?? current.cliff_months,
    vesting_period_months: input.vesting_period_months ?? current.vesting_period_months,
    vesting_frequency: input.vesting_frequency ?? current.vesting_frequency,
    strike_price_cents:
      input.strike_price_cents !== undefined
        ? input.strike_price_cents
        : current.strike_price_cents,
    price_per_share_cents: input.price_per_share_cents ?? current.price_per_share_cents,
    price_as_of: input.price_as_of !== undefined ? input.price_as_of : current.price_as_of,
  })
  await updateRow(ctx, 'equity_grant', input.id, row, 'No equity grant matches that id.')
  return { id: input.id, ...row }
}

/** Deletes an equity grant. */
export function deleteEquityGrant(ctx: NestContext, input: z.infer<typeof deleteEquityGrantInput>) {
  return deleteRow(ctx, 'equity_grant', input.id, 'No equity grant matches that id.')
}
