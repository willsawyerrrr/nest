import { basename } from 'node:path'
import { z } from 'zod'
import {
  carExpenseDeductionCents,
  configsByYear,
  financialYearForDate,
  workFromHomeDeductionCents,
} from '@nest/tax'
import { resolveMember, selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import {
  MAX_REMOTE_CONTENT_LENGTH,
  MAX_REMOTE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  storageKeyName,
  storedContentType,
} from '../upload.ts'
import { automaticGroupError, findGroup, type GroupRow } from './deductionGroups.ts'
import { centsSchema, DEDUCTION_CATEGORIES, isoDateSchema } from './write.ts'

const RECEIPTS_BUCKET = 'receipts'
const DEDUCTION_BASES = ['amount', 'distance', 'hours'] as const

const financialYearSchema = z.number().int().min(2000).max(2100)
const workUsePercentSchema = z.number().gt(0).max(100)
const kilometresSchema = z.number().positive().max(1_000_000)
const hoursSchema = z.number().positive().max(999_999.99)

/** The rate config for a financial year, or a refusal when none is published for it. */
function configFor(financialYear: number) {
  const config = configsByYear[financialYear]
  if (!config) {
    throw new ToolError(
      'invalid_details',
      `No tax rates are published for FY${financialYear}, so a distance or hours claim cannot be priced.`,
    )
  }
  return config
}

/** The share of a cost claimed, rounded to the nearest cent exactly as `deduction_work_use_apportioned` does. */
export function workUseAmountCents(fullAmountCents: number, workUsePercent: number): number {
  const hundredthsOfAPercent = Math.round(workUsePercent * 100)
  return Math.round((fullAmountCents * hundredthsOfAPercent) / 10_000)
}

export interface DeductionRow {
  id: string
  household_id: string
  member_id: string
  description: string
  amount_cents: number
  full_amount_cents: number
  work_use_percent: number
  deduction_date: string
  financial_year: number
  basis: (typeof DEDUCTION_BASES)[number]
  category: (typeof DEDUCTION_CATEGORIES)[number]
  distance_km: number | null
  work_from_home_hours: number | null
  group_id: string | null
}

async function findDeduction(ctx: NestContext, id: string): Promise<DeductionRow> {
  const { data, error } = await ctx.supabase
    .from('deduction')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw fixedError('query_failed')
  if (!data) throw new ToolError('not_found', 'No deduction matches that id.')
  return data as DeductionRow
}

/** Refuses a group a deduction cannot be filed in: an automatic one, or another member's or year's. */
function assertFilable(group: GroupRow, memberId: string, financialYear: number): void {
  if (group.kind === 'donations') throw automaticGroupError()
  if (group.member_id !== memberId || group.financial_year !== financialYear) {
    throw new ToolError(
      'invalid_details',
      'A deduction can only be filed in a group of the same member and financial year.',
    )
  }
}

export const listDeductionsInput = z.object({
  financial_year: financialYearSchema.optional(),
  member: z.string().trim().min(1).optional(),
  category: z.enum(DEDUCTION_CATEGORIES).optional(),
})

/** Lists deductions (default: the current financial year) with their group and whether a receipt is stored. */
export async function listDeductions(ctx: NestContext, input: z.infer<typeof listDeductionsInput>) {
  const financialYear = input.financial_year ?? financialYearForDate(ctx.now())
  const member = input.member === undefined ? null : await resolveMember(ctx, input.member)
  const [deductions, groups, receipts, members] = await Promise.all([
    selectAll<DeductionRow>(ctx, 'deduction', { financial_year: financialYear }),
    selectAll<GroupRow>(ctx, 'deduction_group', { financial_year: financialYear }),
    selectAll<{ deduction_id: string }>(ctx, 'deduction_receipt'),
    selectAll<{ id: string; name: string }>(ctx, 'members'),
  ])
  const receipted = new Set(receipts.map((receipt) => receipt.deduction_id))
  return deductions
    .filter(
      (row) =>
        (member === null || row.member_id === member.id) &&
        (input.category === undefined || row.category === input.category),
    )
    .sort((a, b) => a.deduction_date.localeCompare(b.deduction_date))
    .map((row) => ({
      id: row.id,
      member: members.find((m) => m.id === row.member_id)?.name ?? null,
      category: row.category,
      description: row.description,
      deduction_date: row.deduction_date,
      financial_year: row.financial_year,
      basis: row.basis,
      amount_cents: row.amount_cents,
      full_amount_cents: row.full_amount_cents,
      work_use_percent: row.work_use_percent,
      distance_km: row.distance_km,
      work_from_home_hours: row.work_from_home_hours,
      group_id: row.group_id,
      group: groups.find((g) => g.id === row.group_id)?.name ?? null,
      has_receipt: receipted.has(row.id),
    }))
}

const deductionFields = {
  description: z.string().trim().min(1),
  deduction_date: isoDateSchema,
  amount_cents: centsSchema.optional(),
  work_use_percent: workUsePercentSchema.optional(),
  distance_km: kilometresSchema.optional(),
  work_from_home_hours: hoursSchema.optional(),
}

export const addDeductionInput = z.object({
  ...deductionFields,
  category: z.enum(DEDUCTION_CATEGORIES).default('work_expense'),
  basis: z.enum(DEDUCTION_BASES).default('amount'),
  member: z.string().trim().min(1).optional(),
  group_id: z.uuid().optional(),
})

interface Stated {
  amount_cents?: number | null | undefined
  work_use_percent?: number | undefined
  distance_km?: number | null | undefined
  work_from_home_hours?: number | null | undefined
}

/** The figures a basis stores, derived from what was stated; throws when they do not fit the basis. */
function priced(
  basis: DeductionRow['basis'],
  category: DeductionRow['category'],
  financialYear: number,
  stated: Stated,
) {
  const misfit = (message: string) => new ToolError('invalid_details', message)
  if (basis === 'amount') {
    if (stated.distance_km != null || stated.work_from_home_hours != null) {
      throw misfit(
        'distance_km and work_from_home_hours apply only to the distance and hours bases.',
      )
    }
    if (stated.amount_cents == null) throw misfit('The amount basis needs amount_cents.')
    const percent = stated.work_use_percent ?? 100
    if (percent !== 100 && category !== 'work_expense') {
      throw misfit('Only a work expense can be claimed at less than its full cost.')
    }
    return {
      amount_cents: workUseAmountCents(stated.amount_cents, percent),
      full_amount_cents: stated.amount_cents,
      work_use_percent: percent,
      distance_km: null,
      work_from_home_hours: null,
      warning: null as string | null,
    }
  }
  if (category !== 'work_expense') {
    throw misfit('Only a work expense can be claimed by distance or hours.')
  }
  if (stated.amount_cents != null || (stated.work_use_percent ?? 100) !== 100) {
    throw misfit(
      "A distance or hours claim is priced from the kilometres or hours at the year's published rate; leave out amount_cents and work_use_percent.",
    )
  }
  const config = configFor(financialYear)
  if (basis === 'distance') {
    if (stated.distance_km == null || stated.work_from_home_hours != null) {
      throw misfit('The distance basis needs distance_km alone.')
    }
    const cents = carExpenseDeductionCents(stated.distance_km, config)
    return {
      amount_cents: cents,
      full_amount_cents: cents,
      work_use_percent: 100,
      distance_km: stated.distance_km,
      work_from_home_hours: null,
      warning:
        stated.distance_km > config.carExpense.maxClaimableKm
          ? `The ATO caps this method at ${config.carExpense.maxClaimableKm} km per car per year.`
          : null,
    }
  }
  if (stated.work_from_home_hours == null || stated.distance_km != null) {
    throw misfit('The hours basis needs work_from_home_hours alone.')
  }
  const cents = workFromHomeDeductionCents(stated.work_from_home_hours, config)
  return {
    amount_cents: cents,
    full_amount_cents: cents,
    work_use_percent: 100,
    distance_km: null,
    work_from_home_hours: stated.work_from_home_hours,
    warning: null,
  }
}

/**
 * Adds a deduction by hand. The amount basis takes the full cost in
 * `amount_cents` and a `work_use_percent` (work expenses only); the distance and
 * hours bases take kilometres or hours and snapshot the financial year's
 * published rate into `amount_cents`. A donation is filed in the member's
 * automatic donations group; any other category may be filed in a standard
 * group of the same member and year.
 */
export async function addDeduction(ctx: NestContext, input: z.infer<typeof addDeductionInput>) {
  const member = await resolveMember(ctx, input.member)
  const financialYear = financialYearForDate(new Date(`${input.deduction_date}T00:00:00Z`))
  const { warning, ...stored } = priced(input.basis, input.category, financialYear, input)
  if (input.group_id !== undefined) {
    if (input.category === 'donation') throw automaticGroupError()
    assertFilable(await findGroup(ctx, input.group_id), member.id, financialYear)
  }
  const id = ctx.randomUUID()
  const { error } = await ctx.supabase.rpc('create_deduction_with_receipt', {
    p_deduction: {
      id,
      household_id: ctx.householdId,
      member_id: member.id,
      description: input.description,
      deduction_date: input.deduction_date,
      financial_year: financialYear,
      category: input.category,
      basis: input.basis,
      group_id: input.group_id ?? null,
      ...stored,
    },
  })
  if (error) throw fixedError('save_failed')
  return {
    id,
    member: member.name,
    category: input.category,
    basis: input.basis,
    description: input.description,
    deduction_date: input.deduction_date,
    financial_year: financialYear,
    group_id: input.group_id ?? null,
    ...stored,
    warning,
  }
}

export const updateDeductionInput = z.object({
  id: z.uuid(),
  description: deductionFields.description.optional(),
  deduction_date: deductionFields.deduction_date.optional(),
  amount_cents: deductionFields.amount_cents,
  work_use_percent: deductionFields.work_use_percent,
  distance_km: deductionFields.distance_km,
  work_from_home_hours: deductionFields.work_from_home_hours,
  group_id: z.uuid().nullable().optional(),
})

/**
 * Edits a deduction, changing only the fields given. Category and basis are
 * fixed once a deduction exists. The stored amount is recomputed from the
 * basis's own inputs (full cost and work use, kilometres, or hours) at the
 * financial year's rate.
 */
export async function updateDeduction(
  ctx: NestContext,
  input: z.infer<typeof updateDeductionInput>,
) {
  const row = await findDeduction(ctx, input.id)
  const date = input.deduction_date ?? row.deduction_date
  const financialYear = financialYearForDate(new Date(`${date}T00:00:00Z`))

  const isAmount = row.basis === 'amount'
  const { warning, ...stored } = priced(row.basis, row.category, financialYear, {
    amount_cents: isAmount ? (input.amount_cents ?? row.full_amount_cents) : input.amount_cents,
    work_use_percent: isAmount
      ? (input.work_use_percent ?? row.work_use_percent)
      : input.work_use_percent,
    distance_km:
      row.basis === 'distance' ? (input.distance_km ?? row.distance_km) : input.distance_km,
    work_from_home_hours:
      row.basis === 'hours'
        ? (input.work_from_home_hours ?? row.work_from_home_hours)
        : input.work_from_home_hours,
  })

  let groupId = input.group_id === undefined ? row.group_id : input.group_id
  if (row.category === 'donation') {
    if (input.group_id !== undefined) throw automaticGroupError()
    // A donation's group is automatic; leaving the year refiles it.
    if (financialYear !== row.financial_year) groupId = null
  } else if (groupId !== null) {
    if (input.group_id === undefined && financialYear !== row.financial_year) {
      throw new ToolError(
        'invalid_details',
        'This date moves the deduction to another financial year; pass group_id (or null) to file it again.',
      )
    }
    assertFilable(await findGroup(ctx, groupId), row.member_id, financialYear)
  }

  const next = {
    description: input.description ?? row.description,
    deduction_date: date,
    financial_year: financialYear,
    group_id: groupId,
    ...stored,
  }
  const { data, error } = await ctx.supabase
    .from('deduction')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) throw fixedError('save_failed')
  return { id: input.id, category: row.category, basis: row.basis, ...next, warning }
}

async function storedReceiptPath(ctx: NestContext, deductionId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from('deduction_receipt')
    .select('*')
    .eq('deduction_id', deductionId)
    .maybeSingle()
  if (error) throw fixedError('query_failed')
  return (data as { storage_path: string } | null)?.storage_path ?? null
}

/** Deletes a stored object nothing references. Best effort, never surfaced. */
async function discardObject(ctx: NestContext, path: string): Promise<void> {
  try {
    await ctx.supabase.storage.from(RECEIPTS_BUCKET).remove([path])
  } catch {
    // The object is unreferenced either way.
  }
}

export const deleteDeductionInput = z.object({ id: z.uuid() })

/** Deletes a deduction, its receipt row, and (best effort) the stored receipt file. */
export async function deleteDeduction(
  ctx: NestContext,
  input: z.infer<typeof deleteDeductionInput>,
) {
  await findDeduction(ctx, input.id)
  const path = await storedReceiptPath(ctx, input.id)
  const { error } = await ctx.supabase
    .from('deduction')
    .delete()
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
  if (error) throw fixedError('delete_failed')
  if (path !== null) await discardObject(ctx, path)
  return { id: input.id, deleted: true }
}

/** Over stdio the receipt is a local file. */
export const attachReceiptInput = z.object({
  id: z.uuid(),
  file_path: z.string().trim().min(1),
})

/** Over HTTP there is no shared disk, so the receipt travels as base64. */
export const attachReceiptRemoteInput = z.object({
  id: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(MAX_REMOTE_CONTENT_LENGTH),
})

/** Attaches or replaces a deduction's receipt with a local file. */
export async function attachReceiptFromFile(
  ctx: NestContext,
  input: z.infer<typeof attachReceiptInput>,
) {
  let bytes: Uint8Array
  try {
    bytes = await ctx.readFile(input.file_path)
  } catch {
    throw fixedError('file_unreadable')
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw fixedError('file_too_large')
  return attachReceipt(ctx, input.id, basename(input.file_path), bytes)
}

/** Attaches or replaces a deduction's receipt sent as base64 `content` named `filename`. */
export async function attachReceiptFromContent(
  ctx: NestContext,
  input: z.infer<typeof attachReceiptRemoteInput>,
) {
  const content = input.content.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) {
    throw fixedError('invalid_content')
  }
  const bytes = Buffer.from(content, 'base64')
  if (bytes.byteLength > MAX_REMOTE_UPLOAD_BYTES) throw fixedError('file_too_large')
  return attachReceipt(ctx, input.id, basename(input.filename), bytes)
}

/**
 * Stores the file under `<household_id>/<deduction_id>/…` and points the
 * deduction's one `deduction_receipt` row at it, repointing an existing row and
 * deleting the object it held. Nothing is read from the file.
 */
async function attachReceipt(
  ctx: NestContext,
  deductionId: string,
  fileName: string,
  bytes: Uint8Array,
) {
  await findDeduction(ctx, deductionId)
  const previous = await storedReceiptPath(ctx, deductionId)
  const path = `${ctx.householdId}/${deductionId}/${ctx.randomUUID()}-${storageKeyName(fileName)}`
  const { error: uploadError } = await ctx.supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, bytes, { contentType: storedContentType(fileName) })
  if (uploadError) throw fixedError('upload_failed')

  if (previous === null) {
    const { error } = await ctx.supabase
      .from('deduction_receipt')
      .insert({ household_id: ctx.householdId, deduction_id: deductionId, storage_path: path })
    if (error) {
      await discardObject(ctx, path)
      throw fixedError('save_failed')
    }
  } else {
    const { data, error } = await ctx.supabase
      .from('deduction_receipt')
      .update({ storage_path: path })
      .eq('deduction_id', deductionId)
      .select('id')
    if (error || !data || data.length === 0) {
      await discardObject(ctx, path)
      throw fixedError('save_failed')
    }
    await discardObject(ctx, previous)
  }
  return { id: deductionId, has_receipt: true, replaced: previous !== null }
}

export const removeReceiptInput = z.object({ id: z.uuid() })

/** Removes a deduction's receipt row and (best effort) its stored file. */
export async function removeReceipt(ctx: NestContext, input: z.infer<typeof removeReceiptInput>) {
  await findDeduction(ctx, input.id)
  const path = await storedReceiptPath(ctx, input.id)
  if (path === null) return { id: input.id, has_receipt: false }
  const { error } = await ctx.supabase
    .from('deduction_receipt')
    .delete()
    .eq('deduction_id', input.id)
  if (error) throw fixedError('delete_failed')
  await discardObject(ctx, path)
  return { id: input.id, has_receipt: false }
}
