import { z } from 'zod'
import { annualCents, type Frequency } from '@nest/plan'
import { listMembers, resolveMember, selectAll, type NestContext } from '../context.ts'
import { ToolError } from '../errors.ts'
import {
  deleteRow,
  findRow,
  frequencySchema,
  insertRow,
  intervalCountSchema,
  intervalFor,
  invalid,
  updateRow,
} from './incomeShared.ts'
import { centsSchema, isoDateSchema } from './write.ts'

export const INFLOW_TYPES = ['salary', 'wage', 'other', 'reimbursement', 'hobby', 'gift'] as const
export const ONE_OFF_TAX_TREATMENTS = [
  'ordinary',
  'genuine_redundancy',
  'employment_termination',
  'unused_leave',
] as const

type InflowType = (typeof INFLOW_TYPES)[number]
type OneOffTaxTreatment = (typeof ONE_OFF_TAX_TREATMENTS)[number]

const TAXABLE_TYPES: readonly InflowType[] = ['salary', 'wage', 'other']
const TAXABLE_ONE_OFF_TYPES: readonly InflowType[] = ['salary', 'other']
const NON_TAXABLE_TYPES: readonly InflowType[] = ['reimbursement', 'hobby', 'gift', 'other']

const fields = {
  name: z.string().trim().min(1),
  taxable: z.boolean(),
  member: z.string().trim().min(1),
  type: z.enum(INFLOW_TYPES),
  amount_cents: centsSchema,
  hourly_rate_cents: centsSchema,
  hours_per_period: z.number().positive().max(999_999.99),
  schedule: frequencySchema,
  interval_count: intervalCountSchema,
  paid_on: isoDateSchema,
  one_off_tax_treatment: z.enum(ONE_OFF_TAX_TREATMENTS),
  years_of_service: z.number().int().min(0).max(100),
  attracts_super: z.boolean(),
  pay_schedule: frequencySchema,
  pay_interval_count: intervalCountSchema,
  arrives_every_pay_period: z.boolean(),
  starts_on: isoDateSchema,
  ends_on: isoDateSchema,
  pay_anchor_date: isoDateSchema,
  is_joint: z.boolean(),
  member_split_percent: z.number().int().min(0).max(100),
}

export const addInflowInput = z.object({
  ...fields,
  taxable: fields.taxable.optional(),
  member: fields.member.optional(),
  amount_cents: fields.amount_cents.optional(),
  hourly_rate_cents: fields.hourly_rate_cents.optional(),
  hours_per_period: fields.hours_per_period.optional(),
  schedule: fields.schedule.optional(),
  interval_count: fields.interval_count.optional(),
  paid_on: fields.paid_on.optional(),
  one_off_tax_treatment: fields.one_off_tax_treatment.optional(),
  years_of_service: fields.years_of_service.optional(),
  attracts_super: fields.attracts_super.optional(),
  pay_schedule: fields.pay_schedule.optional(),
  pay_interval_count: fields.pay_interval_count.optional(),
  arrives_every_pay_period: fields.arrives_every_pay_period.optional(),
  starts_on: fields.starts_on.optional(),
  ends_on: fields.ends_on.optional(),
  pay_anchor_date: fields.pay_anchor_date.optional(),
  is_joint: fields.is_joint.optional(),
  member_split_percent: fields.member_split_percent.optional(),
})

export const updateInflowInput = z.object({
  id: z.uuid(),
  name: fields.name.optional(),
  taxable: fields.taxable.optional(),
  member: fields.member.optional(),
  type: fields.type.optional(),
  amount_cents: fields.amount_cents.optional(),
  hourly_rate_cents: fields.hourly_rate_cents.optional(),
  hours_per_period: fields.hours_per_period.optional(),
  schedule: fields.schedule.optional(),
  interval_count: fields.interval_count.optional(),
  paid_on: fields.paid_on.optional(),
  one_off_tax_treatment: fields.one_off_tax_treatment.optional(),
  years_of_service: fields.years_of_service.optional(),
  attracts_super: fields.attracts_super.optional(),
  pay_schedule: fields.pay_schedule.nullable().optional(),
  pay_interval_count: fields.pay_interval_count.nullable().optional(),
  arrives_every_pay_period: fields.arrives_every_pay_period.optional(),
  starts_on: fields.starts_on.nullable().optional(),
  ends_on: fields.ends_on.nullable().optional(),
  pay_anchor_date: fields.pay_anchor_date.nullable().optional(),
  is_joint: fields.is_joint.optional(),
  member_split_percent: fields.member_split_percent.optional(),
})

export const deleteInflowInput = z.object({ id: z.uuid() })

type AddInput = z.infer<typeof addInflowInput>
type UpdateInput = z.infer<typeof updateInflowInput>
/** The fields either tool takes; an add leaves most unset, an update only the ones it changes. */
type InflowChanges = Omit<UpdateInput, 'id'>

interface InflowRecord {
  id: string
  name: string
  taxable: boolean
  member_id: string | null
  type: InflowType
  attracts_super: boolean
  schedule: Frequency | null
  interval_count: number | null
  paid_on: string | null
  one_off_tax_treatment: OneOffTaxTreatment | null
  years_of_service: number | null
  pay_schedule: Frequency | null
  pay_interval_count: number | null
  arrives_every_pay_period: boolean
  amount_cents: number | null
  hourly_rate_cents: number | null
  hours_per_period: number | null
  starts_on: string | null
  ends_on: string | null
  pay_anchor_date: string | null
  is_joint: boolean
  member_split_percent: number | null
}

type InflowWrite = Omit<InflowRecord, 'id'>

const present = (value: unknown) => value !== undefined && value !== null

/**
 * The row an inflow save writes: `existing` (when editing) overlaid with the
 * fields given, then held to the same rules the inflow form and the database's
 * `inflows_*` checks apply — a recurring inflow states a `schedule`, a one-off a
 * `paid_on`, never both; a one-off carries none of the cadence fields; a joint
 * inflow is a recurring taxable `other` with a split.
 */
async function resolveInflow(
  ctx: NestContext,
  existing: InflowRecord | null,
  input: InflowChanges,
): Promise<InflowWrite> {
  if (present(input.paid_on) && present(input.schedule)) {
    throw invalid('Give either schedule (recurring) or paid_on (one-off), not both.')
  }
  const oneOff = present(input.paid_on)
    ? true
    : present(input.schedule)
      ? false
      : existing
        ? existing.paid_on !== null
        : null
  if (oneOff === null) {
    throw invalid('An inflow needs a schedule (recurring) or a paid_on date (one-off).')
  }

  const taxable = input.taxable ?? existing?.taxable ?? true
  const type = input.type ?? existing?.type
  if (!type) {
    throw invalid('An inflow needs a type.')
  }
  const allowedTypes = taxable
    ? oneOff
      ? TAXABLE_ONE_OFF_TYPES
      : TAXABLE_TYPES
    : NON_TAXABLE_TYPES
  if (!allowedTypes.includes(type)) {
    throw invalid(
      `${taxable ? 'A taxable' : 'A non-taxable'} ${oneOff ? 'one-off' : 'inflow'} cannot be of type ${type}; use ${allowedTypes.join(', ')}.`,
    )
  }

  let memberId: string | null = null
  if (taxable) {
    memberId =
      input.member !== undefined
        ? (await resolveMember(ctx, input.member)).id
        : (existing?.member_id ?? null)
    if (memberId === null) {
      throw invalid('A taxable inflow needs a member.')
    }
  } else if (input.member !== undefined) {
    throw invalid('A non-taxable inflow is not tied to a member.')
  }

  let amount: number | null = null
  let hourlyRate: number | null = null
  let hours: number | null = null
  if (type === 'wage') {
    if (input.amount_cents !== undefined) {
      throw invalid('A wage is priced by hourly_rate_cents and hours_per_period, not amount_cents.')
    }
    hourlyRate = input.hourly_rate_cents ?? existing?.hourly_rate_cents ?? null
    hours = input.hours_per_period ?? existing?.hours_per_period ?? null
    if (hourlyRate === null || hours === null) {
      throw invalid('A wage needs hourly_rate_cents and hours_per_period.')
    }
  } else {
    if (input.hourly_rate_cents !== undefined || input.hours_per_period !== undefined) {
      throw invalid('hourly_rate_cents and hours_per_period apply only to a wage.')
    }
    amount = input.amount_cents ?? existing?.amount_cents ?? null
    if (amount === null) {
      throw invalid('An inflow needs amount_cents.')
    }
  }

  const attractsSuperGiven = input.attracts_super
  if (attractsSuperGiven === false && (!taxable || oneOff)) {
    throw invalid('attracts_super applies only to a recurring taxable inflow.')
  }
  const attractsSuper =
    taxable && !oneOff ? (attractsSuperGiven ?? existing?.attracts_super ?? true) : true

  const joint = jointSplit(input, existing, taxable && type === 'other' && !oneOff)

  const common = {
    name: input.name ?? existing?.name ?? '',
    taxable,
    member_id: memberId,
    type,
    attracts_super: attractsSuper,
    amount_cents: amount,
    hourly_rate_cents: hourlyRate,
    hours_per_period: hours,
    is_joint: joint.isJoint,
    member_split_percent: joint.split,
  }
  if (common.name === '') {
    throw invalid('An inflow needs a name.')
  }

  return oneOff
    ? { ...common, ...oneOffFields(input, existing, taxable) }
    : { ...common, ...recurringFields(input, existing) }
}

function jointSplit(
  input: InflowChanges,
  existing: InflowRecord | null,
  eligible: boolean,
): { isJoint: boolean; split: number | null } {
  let isJoint = input.is_joint ?? existing?.is_joint ?? false
  if (isJoint && !eligible) {
    if (input.is_joint === true) {
      throw invalid('Only a recurring taxable inflow of type other can be joint.')
    }
    isJoint = false
  }
  if (!isJoint) {
    if (present(input.member_split_percent)) {
      throw invalid('member_split_percent applies only to a joint inflow.')
    }
    return { isJoint, split: null }
  }
  const split = input.member_split_percent ?? existing?.member_split_percent ?? null
  if (split === null) {
    throw invalid('A joint inflow needs member_split_percent.')
  }
  return { isJoint, split }
}

type CadenceFields = Pick<
  InflowWrite,
  | 'schedule'
  | 'interval_count'
  | 'paid_on'
  | 'one_off_tax_treatment'
  | 'years_of_service'
  | 'pay_schedule'
  | 'pay_interval_count'
  | 'arrives_every_pay_period'
  | 'starts_on'
  | 'ends_on'
  | 'pay_anchor_date'
>

function recurringFields(input: InflowChanges, existing: InflowRecord | null): CadenceFields {
  if (present(input.one_off_tax_treatment) || present(input.years_of_service)) {
    throw invalid('one_off_tax_treatment and years_of_service apply only to a one-off.')
  }
  const schedule = input.schedule ?? existing?.schedule
  if (!schedule) {
    throw invalid('A recurring inflow needs a schedule.')
  }
  const interval = intervalFor(
    schedule,
    input.schedule !== undefined
      ? input.interval_count
      : (input.interval_count ?? existing?.interval_count),
  )
  const paySchedule =
    input.pay_schedule !== undefined ? input.pay_schedule : (existing?.pay_schedule ?? null)
  const payInterval = intervalFor(
    paySchedule ?? 'none',
    input.pay_schedule !== undefined
      ? input.pay_interval_count
      : (input.pay_interval_count ?? existing?.pay_interval_count),
    'pay_interval_count',
  )
  const startsOn = input.starts_on !== undefined ? input.starts_on : (existing?.starts_on ?? null)
  const endsOn = input.ends_on !== undefined ? input.ends_on : (existing?.ends_on ?? null)
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    throw invalid('ends_on cannot be before starts_on.')
  }
  return {
    schedule,
    interval_count: interval,
    paid_on: null,
    one_off_tax_treatment: null,
    years_of_service: null,
    pay_schedule: paySchedule,
    pay_interval_count: payInterval,
    arrives_every_pay_period:
      input.arrives_every_pay_period ?? existing?.arrives_every_pay_period ?? true,
    starts_on: startsOn,
    ends_on: endsOn,
    pay_anchor_date:
      input.pay_anchor_date !== undefined
        ? input.pay_anchor_date
        : (existing?.pay_anchor_date ?? null),
  }
}

function oneOffFields(
  input: InflowChanges,
  existing: InflowRecord | null,
  taxable: boolean,
): CadenceFields {
  if (
    present(input.interval_count) ||
    present(input.pay_schedule) ||
    present(input.pay_interval_count) ||
    present(input.starts_on) ||
    present(input.ends_on) ||
    present(input.pay_anchor_date) ||
    input.arrives_every_pay_period === false
  ) {
    throw invalid(
      'A one-off carries no cadence: no interval_count, pay_schedule, pay_interval_count, starts_on, ends_on, pay_anchor_date, or arrives_every_pay_period.',
    )
  }
  const paidOn = input.paid_on ?? existing?.paid_on
  if (!paidOn) {
    throw invalid('A one-off needs a paid_on date.')
  }
  let treatment: OneOffTaxTreatment | null = null
  let years: number | null = null
  if (taxable) {
    treatment = input.one_off_tax_treatment ?? existing?.one_off_tax_treatment ?? 'ordinary'
    if (treatment === 'genuine_redundancy') {
      years = input.years_of_service ?? existing?.years_of_service ?? null
      if (years === null) {
        throw invalid('A genuine redundancy needs years_of_service.')
      }
    } else if (present(input.years_of_service)) {
      throw invalid('years_of_service applies only to a genuine redundancy.')
    }
  } else if (present(input.one_off_tax_treatment) || present(input.years_of_service)) {
    throw invalid('A non-taxable one-off has no tax treatment or years_of_service.')
  }
  return {
    schedule: null,
    interval_count: null,
    paid_on: paidOn,
    one_off_tax_treatment: treatment,
    years_of_service: years,
    pay_schedule: null,
    pay_interval_count: null,
    arrives_every_pay_period: true,
    starts_on: null,
    ends_on: null,
    pay_anchor_date: null,
  }
}

/** Annualised cents of a recurring inflow; null for a one-off, which has no cadence. */
function annualOf(row: InflowRecord): number | null {
  if (row.schedule === null) return null
  const perPeriod =
    row.type === 'wage'
      ? Math.round((row.hourly_rate_cents ?? 0) * Number(row.hours_per_period ?? 0))
      : (row.amount_cents ?? 0)
  return annualCents(perPeriod, row.schedule, row.interval_count ?? undefined)
}

/** The household's inflows (recurring and one-off), optionally narrowed by name, with annualised cents for recurring ones. */
export async function listInflows(ctx: NestContext, input: { name?: string | undefined }) {
  const [rows, members] = await Promise.all([
    selectAll<InflowRecord>(ctx, 'inflows'),
    listMembers(ctx),
  ])
  const nameById = new Map(members.map((member) => [member.id, member.name]))
  const needle = input.name?.trim().toLowerCase()
  const inflows = rows
    .filter((row) => needle === undefined || row.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({
      id: row.id,
      name: row.name,
      taxable: row.taxable,
      member_id: row.member_id,
      member: row.member_id === null ? null : (nameById.get(row.member_id) ?? null),
      type: row.type,
      recurrence: row.paid_on === null ? ('recurring' as const) : ('one_off' as const),
      amount_cents: row.amount_cents,
      hourly_rate_cents: row.hourly_rate_cents,
      hours_per_period: row.hours_per_period === null ? null : Number(row.hours_per_period),
      schedule: row.schedule,
      interval_count: row.interval_count,
      annual_cents: annualOf(row),
      paid_on: row.paid_on,
      one_off_tax_treatment: row.one_off_tax_treatment,
      years_of_service: row.years_of_service,
      attracts_super: row.attracts_super,
      pay_schedule: row.pay_schedule,
      pay_interval_count: row.pay_interval_count,
      arrives_every_pay_period: row.arrives_every_pay_period,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      pay_anchor_date: row.pay_anchor_date,
      is_joint: row.is_joint,
      member_split_percent: row.member_split_percent,
    }))
  return { inflows }
}

/** Adds an inflow, recurring or one-off, to the household. */
export async function addInflow(ctx: NestContext, input: AddInput) {
  const row = await resolveInflow(ctx, null, input)
  const id = await insertRow(ctx, 'inflows', { household_id: ctx.householdId, ...row })
  return { id, ...row }
}

/** Edits an inflow, changing only the fields given; supplying `schedule` or `paid_on` switches it between recurring and one-off. */
export async function updateInflow(ctx: NestContext, input: UpdateInput) {
  const existing = await findRow<InflowRecord>(ctx, 'inflows', input.id)
  if (!existing) {
    throw new ToolError('not_found', 'No inflow matches that id.')
  }
  const { id, ...changes } = input
  const row = await resolveInflow(ctx, existing, changes)
  await updateRow(ctx, 'inflows', id, row, 'No inflow matches that id.')
  return { id, ...row }
}

/** Deletes an inflow. */
export function deleteInflow(ctx: NestContext, input: z.infer<typeof deleteInflowInput>) {
  return deleteRow(ctx, 'inflows', input.id, 'No inflow matches that id.')
}
