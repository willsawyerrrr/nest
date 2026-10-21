import { z } from 'zod'
import type { NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'

/** The Up category the "From your card" inbox is built from. */
export const GIFT_TRANSACTION_CATEGORY = 'gifts-and-charity'

/** The zone a transaction's posting instant is read in to give the purchase date. */
export const LOCAL_ZONE = 'Australia/Sydney'

export interface RecipientRow {
  id: string
  name: string
  member_id: string | null
}
export interface OccasionRow {
  id: string
  name: string
  occasion_date: string | null
}
export interface BudgetRow {
  id: string
  recipient_id: string
  occasion_id: string
  budgeted_amount_cents: number
  event_date: string | null
}
export interface PurchaseRow {
  id: string
  gift_budget_id: string | null
  gift_discretionary_budget_id: string | null
  recipient_id: string | null
  amount_cents: number
  description: string
  purchased_on: string
  transaction_id: string | null
}
export interface DiscretionaryRow {
  id: string
  budgeted_amount_cents: number
}
export interface TransactionRow {
  id: string
  description: string
  amount_cents: number
  posted_at: string
  status: string
  external_category: string | null
}
export interface DismissalRow {
  id: string
  transaction_id: string
}

export const idSchema = z.uuid()
export const nameSchema = z.string().trim().min(1)

export async function findById<T>(ctx: NestContext, table: string, id: string): Promise<T | null> {
  const { data, error } = await ctx.supabase.from(table).select('*').eq('id', id).maybeSingle()
  if (error) throw fixedError('query_failed')
  return (data as T | null) ?? null
}

export async function mustFind<T>(
  ctx: NestContext,
  table: string,
  id: string,
  what: string,
): Promise<T> {
  const row = await findById<T>(ctx, table, id)
  if (!row) throw new ToolError('not_found', `No ${what} matches that id.`)
  return row
}

export async function insertRow(
  ctx: NestContext,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await ctx.supabase
    .from(table)
    .insert({ household_id: ctx.householdId, ...row })
    .select('id')
    .single()
  if (error || !data) throw fixedError('save_failed')
  return (data as { id: string }).id
}

export async function updateRow(
  ctx: NestContext,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await ctx.supabase
    .from(table)
    .update(patch)
    .eq('id', id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) throw fixedError('save_failed')
}

export async function deleteRow(ctx: NestContext, table: string, id: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error) throw fixedError('save_failed')
  if (!data || data.length === 0) throw new ToolError('not_found', 'No such record to delete.')
}

/** A transaction's local calendar date (`YYYY-MM-DD`). */
export function localDate(postedAt: string): string {
  return new Date(postedAt).toLocaleDateString('en-CA', { timeZone: LOCAL_ZONE })
}
