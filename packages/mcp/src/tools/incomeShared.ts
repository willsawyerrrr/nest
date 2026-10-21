import { z } from 'zod'
import type { Frequency } from '@nest/plan'
import { financialYearForDate } from '@nest/tax'
import type { NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'

export const FREQUENCIES = [
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'biannual',
  'annual',
  'every_n_weeks',
  'every_n_months',
] as const satisfies readonly Frequency[]

export const frequencySchema = z.enum(FREQUENCIES)

/** The count of an `every_n_*` cadence, in weeks or months. */
export const intervalCountSchema = z.number().int().min(1).max(1_000)

/** An AU financial year, labelled by its ending year. */
export const financialYearSchema = z.number().int().min(2000).max(2100)

/** The given financial year, else the one `ctx.now()` falls in. */
export function financialYearOrCurrent(ctx: NestContext, given: number | undefined): number {
  return given ?? financialYearForDate(ctx.now())
}

export const hasInterval = (frequency: string | null | undefined) =>
  frequency === 'every_n_weeks' || frequency === 'every_n_months'

/** An input the database or the PWA's forms would refuse. */
export function invalid(message: string): ToolError {
  return new ToolError('invalid_details', message)
}

/**
 * The count the database holds for `frequency`: required for `every_n_*`, null
 * for every fixed one, which takes none.
 */
export function intervalFor(
  frequency: string,
  count: number | null | undefined,
  label = 'interval_count',
): number | null {
  if (!hasInterval(frequency)) {
    if (count !== undefined && count !== null) {
      throw invalid(`${label} applies only to every_n_weeks and every_n_months.`)
    }
    return null
  }
  if (count === undefined || count === null) {
    throw invalid(`${frequency} needs ${label}.`)
  }
  return count
}

/** Inserts one row and returns its id. */
export async function insertRow(
  ctx: NestContext,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await ctx.supabase.from(table).insert(row).select('id').single()
  if (error || !data) {
    throw fixedError('save_failed')
  }
  return (data as { id: string }).id
}

/** Updates one household row by id; a row that is hidden or absent is `not_found`. */
export async function updateRow(
  ctx: NestContext,
  table: string,
  id: string,
  row: Record<string, unknown>,
  missing: string,
): Promise<void> {
  const { data, error } = await ctx.supabase
    .from(table)
    .update(row)
    .eq('id', id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error) {
    throw fixedError('save_failed')
  }
  if (!data || data.length === 0) {
    throw new ToolError('not_found', missing)
  }
}

/** Deletes one household row by id; a row that is hidden or absent is `not_found`. */
export async function deleteRow(
  ctx: NestContext,
  table: string,
  id: string,
  missing: string,
): Promise<{ id: string; deleted: true }> {
  const { data, error } = await ctx.supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error) {
    throw fixedError('save_failed')
  }
  if (!data || data.length === 0) {
    throw new ToolError('not_found', missing)
  }
  return { id, deleted: true }
}

/** Reads one row by id, or `null` when none is visible. */
export async function findRow<T>(ctx: NestContext, table: string, id: string): Promise<T | null> {
  const { data, error } = await ctx.supabase.from(table).select('*').eq('id', id).maybeSingle()
  if (error) {
    throw fixedError('query_failed')
  }
  return (data as T | null) ?? null
}
