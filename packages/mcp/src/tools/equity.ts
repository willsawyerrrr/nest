import { z } from 'zod'
import {
  grantValueCents,
  heldShareQuantity,
  unexercisedVestedQuantity,
  vestedQuantity,
  type EquityGrant,
} from '@nest/plan'
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

interface UnitsRecord {
  id: string
  grant_id: string
  quantity: number
}

/** The whole units of a grant already exercised and sold, summed from its recorded rows. */
function unitsMoved(
  grantId: string,
  exercises: readonly UnitsRecord[],
  sales: readonly UnitsRecord[],
) {
  const total = (rows: readonly UnitsRecord[]) =>
    rows.filter((row) => row.grant_id === grantId).reduce((sum, row) => sum + row.quantity, 0)
  return { exercised: total(exercises), sold: total(sales) }
}

const toEngine = (
  grant: EquityGrantRecord,
  exercises: readonly UnitsRecord[] = [],
  sales: readonly UnitsRecord[] = [],
): EquityGrant => ({
  quantity: grant.quantity,
  grantDate: grant.grant_date,
  cliffMonths: grant.cliff_months,
  vestingPeriodMonths: grant.vesting_period_months,
  vestingFrequency: grant.vesting_frequency,
  instrumentType: grant.instrument_type,
  strikePriceCents: grant.strike_price_cents,
  pricePerShareCents: grant.price_per_share_cents,
  exercisedQuantity: unitsMoved(grant.id, exercises, sales).exercised,
  soldQuantity: unitsMoved(grant.id, exercises, sales).sold,
})

/** The columns a grant saves; an option may carry a strike, a share never does. */
type GrantWrite = Omit<EquityGrantRecord, 'id'>

function shape(grant: GrantWrite): GrantWrite {
  return {
    ...grant,
    strike_price_cents: grant.instrument_type === 'option' ? grant.strike_price_cents : null,
  }
}

/**
 * The household's equity grants as of today, with the units vested, exercised,
 * sold, and held as shares, and the value in cents that counts toward net worth:
 * unexercised vested options at their gain over the strike, held shares at the
 * price per share.
 */
export async function listEquityGrants(ctx: NestContext) {
  const [grants, exercises, sales, members] = await Promise.all([
    selectAll<EquityGrantRecord>(ctx, 'equity_grant'),
    selectAll<UnitsRecord>(ctx, 'equity_exercise'),
    selectAll<UnitsRecord>(ctx, 'equity_sale'),
    listMembers(ctx),
  ])
  const nameById = new Map(members.map((member) => [member.id, member.name]))
  const now = ctx.now()
  const shaped = grants
    .sort((a, b) => a.grant_date.localeCompare(b.grant_date) || a.label.localeCompare(b.label))
    .map((grant) => {
      const engine = toEngine(grant, exercises, sales)
      return {
        ...grant,
        member: nameById.get(grant.member_id) ?? null,
        vested_quantity: vestedQuantity(engine, now),
        exercised_quantity: engine.exercisedQuantity ?? 0,
        sold_quantity: engine.soldQuantity ?? 0,
        unexercised_vested_quantity: unexercisedVestedQuantity(engine, now),
        held_share_quantity: heldShareQuantity(engine, now),
        vested_value_cents: grantValueCents(engine, now),
      }
    })
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

export const recordEquityExerciseInput = z.object({
  grant_id: z.uuid(),
  exercised_on: isoDateSchema,
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  strike_price_cents: centsSchema.optional(),
  market_price_per_share_cents: centsSchema.optional(),
})

export const recordEquitySaleInput = z.object({
  grant_id: z.uuid(),
  sold_on: isoDateSchema,
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  price_per_share_cents: centsSchema,
  fee_cents: centsSchema.optional(),
})

export const deleteEquityExerciseInput = z.object({ id: z.uuid() })
export const deleteEquitySaleInput = z.object({ id: z.uuid() })

/** Loads a grant with the units its exercises and sales have already moved. */
async function grantWithUnits(ctx: NestContext, grantId: string) {
  const grant = await findRow<EquityGrantRecord>(ctx, 'equity_grant', grantId)
  if (!grant) {
    throw new ToolError('not_found', 'No equity grant matches that id.')
  }
  const [exercises, sales] = await Promise.all([
    selectAll<UnitsRecord>(ctx, 'equity_exercise', { grant_id: grantId }),
    selectAll<UnitsRecord>(ctx, 'equity_sale', { grant_id: grantId }),
  ])
  return { grant, ...unitsMoved(grantId, exercises, sales) }
}

/**
 * Records an exercise of options from an option grant (id from
 * `list_equity_grants`). The strike paid defaults to the grant's. Refused when it
 * would exercise more options than the grant holds.
 */
export async function recordEquityExercise(
  ctx: NestContext,
  input: z.infer<typeof recordEquityExerciseInput>,
) {
  const { grant, exercised } = await grantWithUnits(ctx, input.grant_id)
  if (grant.instrument_type !== 'option') {
    throw invalid('Only an option grant can be exercised.')
  }
  if (exercised + input.quantity > grant.quantity) {
    throw invalid('That exceeds the options left to exercise.')
  }
  const row = {
    member_id: grant.member_id,
    grant_id: grant.id,
    exercised_on: input.exercised_on,
    quantity: input.quantity,
    strike_price_cents: input.strike_price_cents ?? grant.strike_price_cents ?? 0,
    market_price_per_share_cents: input.market_price_per_share_cents ?? null,
  }
  const id = await insertRow(ctx, 'equity_exercise', { household_id: ctx.householdId, ...row })
  return { id, grant: grant.label, ...row }
}

/**
 * Records a sale of shares from a grant: exercised options for an option grant,
 * granted shares for a share grant. Refused when it would sell more than is held.
 */
export async function recordEquitySale(
  ctx: NestContext,
  input: z.infer<typeof recordEquitySaleInput>,
) {
  const { grant, exercised, sold } = await grantWithUnits(ctx, input.grant_id)
  const sellable = (grant.instrument_type === 'option' ? exercised : grant.quantity) - sold
  if (input.quantity > sellable) {
    throw invalid('That exceeds the shares left to sell.')
  }
  const row = {
    member_id: grant.member_id,
    grant_id: grant.id,
    sold_on: input.sold_on,
    quantity: input.quantity,
    price_per_share_cents: input.price_per_share_cents,
    fee_cents: input.fee_cents ?? 0,
  }
  const id = await insertRow(ctx, 'equity_sale', { household_id: ctx.householdId, ...row })
  return { id, grant: grant.label, ...row }
}

/** Deletes a recorded exercise. Refused by the database when shares sold depend on it. */
export function deleteEquityExercise(
  ctx: NestContext,
  input: z.infer<typeof deleteEquityExerciseInput>,
) {
  return deleteRow(ctx, 'equity_exercise', input.id, 'No equity exercise matches that id.')
}

/** Deletes a recorded sale. */
export function deleteEquitySale(ctx: NestContext, input: z.infer<typeof deleteEquitySaleInput>) {
  return deleteRow(ctx, 'equity_sale', input.id, 'No equity sale matches that id.')
}
