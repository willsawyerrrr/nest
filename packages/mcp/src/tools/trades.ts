import { basename } from 'node:path'
import { z } from 'zod'
import {
  financialYearForDate,
  holdingValueCents,
  lastPriceByTicker,
  matchTrades,
  type TradeInput,
} from '@nest/tax'
import { listMembers, resolveMember, selectAll, type NestContext } from '../context.ts'
import { fixedError, ToolError } from '../errors.ts'
import {
  canExtract,
  MAX_REMOTE_CONTENT_LENGTH,
  MAX_REMOTE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  storageKeyName,
  storedContentType,
} from '../upload.ts'
import { centsSchema, isoDateSchema } from './write.ts'

const DOCUMENTS_BUCKET = 'receipts'
const SIDES = ['buy', 'sell'] as const
const MICRO = 1_000_000

interface TradeRow {
  id: string
  member_id: string
  ticker: string
  side: (typeof SIDES)[number]
  traded_on: string
  units: number | string
  price_per_unit_microdollars: number
  fee_cents: number
  document_id: string | null
}

const tickerSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toUpperCase())

/** Units to at most six decimal places, as the `numeric(20, 6)` column holds them. */
const unitsSchema = z
  .number()
  .positive()
  .refine((value) => Math.abs(value * MICRO - Math.round(value * MICRO)) < 1e-4, {
    message: 'Expected at most six decimal places',
  })

/** A unit price in whole microdollars (millionths of a dollar; $33.083072 is 33_083_072). */
const microdollarsSchema = centsSchema

export const listTradesInput = z.object({
  member: z.string().trim().min(1).optional(),
  ticker: tickerSchema.optional(),
})

export const listHoldingsInput = z.object({ member: z.string().trim().min(1).optional() })

export const addTradeInput = z.object({
  member: z.string().trim().min(1).optional(),
  ticker: tickerSchema,
  side: z.enum(SIDES),
  traded_on: isoDateSchema,
  units: unitsSchema,
  price_per_unit_microdollars: microdollarsSchema,
  fee_cents: centsSchema.optional(),
})

export const updateTradeInput = z.object({
  id: z.uuid(),
  ticker: tickerSchema.optional(),
  side: z.enum(SIDES).optional(),
  traded_on: isoDateSchema.optional(),
  units: unitsSchema.optional(),
  price_per_unit_microdollars: microdollarsSchema.optional(),
  fee_cents: centsSchema.optional(),
})

export const deleteTradeInput = z.object({ id: z.uuid() })

const documentDetails = z.object({
  member: z.string().trim().min(1).optional(),
  financial_year: z.number().int().min(2000).max(2100).optional(),
})

/** Over stdio the document is a local file. */
export const createTradesFromDocumentInput = documentDetails.extend({
  file_path: z.string().trim().min(1),
})

/** Over HTTP the document travels as base64. */
export const createTradesFromDocumentRemoteInput = documentDetails.extend({
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(MAX_REMOTE_CONTENT_LENGTH),
})

function view(row: TradeRow, memberName: string | undefined) {
  return {
    id: row.id,
    member: memberName ?? null,
    ticker: row.ticker,
    side: row.side,
    traded_on: row.traded_on,
    units: Number(row.units),
    price_per_unit_microdollars: row.price_per_unit_microdollars,
    fee_cents: row.fee_cents,
    has_document: row.document_id !== null,
  }
}

function toInputs(rows: readonly TradeRow[]): TradeInput[] {
  return rows.map((row) => ({
    memberId: row.member_id,
    ticker: row.ticker,
    side: row.side,
    tradedOn: row.traded_on,
    units: Number(row.units),
    pricePerUnitMicrodollars: row.price_per_unit_microdollars,
    feeCents: row.fee_cents,
  }))
}

/** Lists the household's trades, newest first, optionally for one member or ticker. */
export async function listTrades(ctx: NestContext, input: z.infer<typeof listTradesInput>) {
  const member = input.member === undefined ? null : await resolveMember(ctx, input.member)
  const [rows, members] = await Promise.all([selectAll<TradeRow>(ctx, 'trade'), listMembers(ctx)])
  const names = new Map(members.map((m) => [m.id, m.name]))
  return rows
    .filter(
      (row) =>
        (member === null || row.member_id === member.id) &&
        (input.ticker === undefined || row.ticker === input.ticker),
    )
    .sort((a, b) => b.traded_on.localeCompare(a.traded_on))
    .map((row) => view(row, names.get(row.member_id)))
}

/**
 * Lists current holdings, FIFO-matched per member and ticker from every
 * household trade and valued at each ticker's last traded price, plus any units
 * sold beyond what the recorded buys cover.
 */
export async function listHoldings(ctx: NestContext, input: z.infer<typeof listHoldingsInput>) {
  const member = input.member === undefined ? null : await resolveMember(ctx, input.member)
  const [rows, members] = await Promise.all([selectAll<TradeRow>(ctx, 'trade'), listMembers(ctx)])
  const names = new Map(members.map((m) => [m.id, m.name]))
  const inputs = toInputs(rows)
  const prices = lastPriceByTicker(inputs)
  const { holdings, unmatchedSales } = matchTrades(inputs)
  const mine = <T extends { memberId: string }>(item: T) =>
    member === null || item.memberId === member.id
  return {
    holdings: holdings.filter(mine).map((holding) => {
      const last = prices.get(holding.ticker) ?? 0
      return {
        member: names.get(holding.memberId) ?? null,
        ticker: holding.ticker,
        units: holding.units,
        cost_base_cents: holding.costBaseCents,
        average_cost_microdollars: holding.averageCostMicrodollars,
        last_price_microdollars: last,
        value_cents: holdingValueCents(holding, last),
      }
    }),
    unmatched_sales: unmatchedSales.filter(mine).map((sale) => ({
      member: names.get(sale.memberId) ?? null,
      ticker: sale.ticker,
      sold_on: sale.soldOn,
      units: sale.units,
    })),
  }
}

/** Records a manual buy or sell. */
export async function addTrade(ctx: NestContext, input: z.infer<typeof addTradeInput>) {
  const member = await resolveMember(ctx, input.member)
  const row = {
    household_id: ctx.householdId,
    member_id: member.id,
    ticker: input.ticker,
    side: input.side,
    traded_on: input.traded_on,
    units: input.units,
    price_per_unit_microdollars: input.price_per_unit_microdollars,
    fee_cents: input.fee_cents ?? 0,
  }
  const { data, error } = await ctx.supabase.from('trade').insert(row).select('id').single()
  if (error || !data) {
    throw fixedError('save_failed')
  }
  return {
    id: (data as { id: string }).id,
    member: member.name,
    ticker: row.ticker,
    side: row.side,
    traded_on: row.traded_on,
    units: row.units,
    price_per_unit_microdollars: row.price_per_unit_microdollars,
    fee_cents: row.fee_cents,
  }
}

async function findTrade(ctx: NestContext, id: string): Promise<TradeRow> {
  const { data, error } = await ctx.supabase.from('trade').select('*').eq('id', id).maybeSingle()
  if (error) {
    throw fixedError('query_failed')
  }
  if (!data) {
    throw new ToolError('not_found', 'No trade matches that id.')
  }
  return data as TradeRow
}

/** Edits a trade, changing only the fields given. */
export async function updateTrade(ctx: NestContext, input: z.infer<typeof updateTradeInput>) {
  const trade = await findTrade(ctx, input.id)
  const next = {
    ticker: input.ticker ?? trade.ticker,
    side: input.side ?? trade.side,
    traded_on: input.traded_on ?? trade.traded_on,
    units: input.units ?? Number(trade.units),
    price_per_unit_microdollars:
      input.price_per_unit_microdollars ?? trade.price_per_unit_microdollars,
    fee_cents: input.fee_cents ?? trade.fee_cents,
  }
  const { data, error } = await ctx.supabase
    .from('trade')
    .update(next)
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
    .select('id')
  if (error || !data || data.length === 0) {
    throw fixedError('save_failed')
  }
  return { id: input.id, ...next }
}

/** Deletes a trade; holdings and gains are derived, so they recalculate. */
export async function deleteTrade(ctx: NestContext, input: z.infer<typeof deleteTradeInput>) {
  await findTrade(ctx, input.id)
  const { error } = await ctx.supabase
    .from('trade')
    .delete()
    .eq('id', input.id)
    .eq('household_id', ctx.householdId)
  if (error) {
    throw fixedError('delete_failed')
  }
  return { id: input.id, deleted: true }
}

const extractedTrade = z.object({
  fields: z
    .object({
      ticker: z.string().optional(),
      side: z.enum(SIDES).optional(),
      traded_on: isoDateSchema.optional(),
      units: z.number().positive().optional(),
      price_per_unit_microdollars: z.number().int().nonnegative().optional(),
      fee_cents: z.number().int().nonnegative().optional(),
    })
    .partial(),
})
const extractionBody = z.object({ model: z.string(), trades: z.array(extractedTrade) })

const EXTRACTION_MESSAGES = {
  extraction_unavailable:
    'Reading documents is switched off for this household. Add the trades with add_trade.',
  extraction_not_trade_document:
    'The file does not look like a contract note, trade confirmation, or statement with trades in it.',
  extraction_unsupported_type:
    'This file type cannot be read automatically. Add the trades with add_trade.',
  extraction_failed: 'The document could not be read. Add the trades with add_trade.',
} as const

function extractionError(code: keyof typeof EXTRACTION_MESSAGES): ToolError {
  return new ToolError(code, EXTRACTION_MESSAGES[code])
}

/** Maps a non-2xx `trade-extract` body onto a stable code; the body itself is never relayed. */
function extractionFailureCode(body: unknown): keyof typeof EXTRACTION_MESSAGES {
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null
  switch (code) {
    case 'unsupported_type':
      return 'extraction_unsupported_type'
    case 'not_configured':
    case 'out_of_credit':
    case 'key_rejected':
      return 'extraction_unavailable'
    case 'not_trade_document':
    case 'no_trades':
      return 'extraction_not_trade_document'
    default:
      return 'extraction_failed'
  }
}

async function extractTrades(ctx: NestContext, path: string, financialYear: number) {
  const { data, error } = await ctx.supabase.functions.invoke<unknown>('trade-extract', {
    body: { path, financialYear },
  })
  if (error) {
    const response = (error as { context?: unknown }).context
    const body = response instanceof Response ? await response.json().catch(() => null) : null
    throw extractionError(extractionFailureCode(body))
  }
  const parsed = extractionBody.safeParse(data)
  if (!parsed.success) {
    throw extractionError('extraction_failed')
  }
  return parsed.data.trades.map((trade) => trade.fields)
}

/** Records the trades on a local broker document, read from `file_path`. */
export async function createTradesFromDocument(
  ctx: NestContext,
  input: z.infer<typeof createTradesFromDocumentInput>,
) {
  let bytes: Uint8Array
  try {
    bytes = await ctx.readFile(input.file_path)
  } catch {
    throw fixedError('file_unreadable')
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw fixedError('file_too_large')
  }
  return createTradesFromBytes(ctx, input, basename(input.file_path), bytes)
}

/** Records the trades on a broker document sent as base64 `content` named `filename`. */
export async function createTradesFromContent(
  ctx: NestContext,
  input: z.infer<typeof createTradesFromDocumentRemoteInput>,
) {
  const content = input.content.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4 === 1) {
    throw fixedError('invalid_content')
  }
  const bytes = Buffer.from(content, 'base64')
  if (bytes.byteLength > MAX_REMOTE_UPLOAD_BYTES) {
    throw fixedError('file_too_large')
  }
  return createTradesFromBytes(ctx, input, basename(input.filename), bytes)
}

/**
 * Stores a broker document in the `receipts` bucket under
 * `<household_id>/<document_id>/…`, reads every trade on it through
 * `trade-extract`, and writes the document and trades together with
 * `create_trades_with_document` under client-minted ids. A trade the document
 * does not fully state is never guessed at: the call fails. A failure after the
 * upload deletes the stored file.
 */
async function createTradesFromBytes(
  ctx: NestContext,
  input: z.infer<typeof documentDetails>,
  fileName: string,
  bytes: Uint8Array,
) {
  if (!canExtract(fileName)) {
    throw extractionError('extraction_unsupported_type')
  }
  const member = await resolveMember(ctx, input.member)
  const documentId = ctx.randomUUID()
  const path = `${ctx.householdId}/${documentId}/${ctx.randomUUID()}-${storageKeyName(fileName)}`
  const { error: uploadError } = await ctx.supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: storedContentType(fileName) })
  if (uploadError) {
    throw fixedError('upload_failed')
  }

  try {
    const extracted = await extractTrades(
      ctx,
      path,
      input.financial_year ?? financialYearForDate(ctx.now()),
    )
    const trades = extracted.map((fields) => {
      const { ticker, side, traded_on, units, price_per_unit_microdollars } = fields
      if (
        ticker === undefined ||
        ticker.trim() === '' ||
        side === undefined ||
        traded_on === undefined ||
        units === undefined ||
        price_per_unit_microdollars === undefined
      ) {
        throw new ToolError(
          'incomplete_details',
          'The document did not fully show every trade. Add them with add_trade.',
        )
      }
      return {
        id: ctx.randomUUID(),
        ticker: ticker.trim().toUpperCase(),
        side,
        traded_on,
        units,
        price_per_unit_microdollars,
        fee_cents: fields.fee_cents ?? 0,
      }
    })

    const existing = await selectAll<TradeRow>(ctx, 'trade')
    const possibleDuplicates = trades
      .filter((trade) =>
        existing.some(
          (row) =>
            row.member_id === member.id &&
            row.ticker === trade.ticker &&
            row.traded_on === trade.traded_on &&
            Number(row.units) === trade.units &&
            row.price_per_unit_microdollars === trade.price_per_unit_microdollars,
        ),
      )
      .map((trade) => trade.id)

    const { error } = await ctx.supabase.rpc('create_trades_with_document', {
      p_household_id: ctx.householdId,
      p_document_id: documentId,
      p_document_path: path,
      p_trades: trades.map((trade) => ({ ...trade, member_id: member.id })),
    })
    if (error) {
      throw fixedError('save_failed')
    }
    return {
      document_id: documentId,
      member: member.name,
      trades,
      possible_duplicates: possibleDuplicates,
      note: 'Trades were read from the document by AI; check them against it.',
    }
  } catch (error) {
    try {
      await ctx.supabase.storage.from(DOCUMENTS_BUCKET).remove([path])
    } catch {
      // The object is unreferenced either way.
    }
    throw error
  }
}
