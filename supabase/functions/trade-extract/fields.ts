/**
 * The trade fields extraction reads, and the shaping of a model response into
 * the payload the client builds its reviewable drafts from.
 *
 * The model reports each figure as the literal text printed on the document;
 * this module converts that text to the column-shaped values — an upper-case
 * ticker, a side, an ISO date, units, and integer cents — keeps the text
 * alongside so the form can show what was read, and names the fields that came
 * back empty or unreadable. Everything here is pure: nothing calls an API or a
 * database, and nothing writes a trade.
 */

import { isPlaceholder, parseCents, parseIsoDate } from '../_shared/money.ts'

/** The most trades read from one document; the rest are left to be added by hand. */
export const MAX_TRADES = 100

/** The text fields the model reports for each trade. */
export const TEXT_FIELDS = [
  'ticker',
  'side',
  'trade_date',
  'units',
  'price_per_unit',
  'brokerage_fee',
] as const

export type TextField = (typeof TEXT_FIELDS)[number]

/** A key of a trade's `fields`, named as the `trade` column is. */
export type ExtractedField =
  | 'ticker'
  | 'side'
  | 'traded_on'
  | 'units'
  | 'price_per_unit_cents'
  | 'fee_cents'

/** What the model reports for one trade: the literal text it read for each field, or null. */
export type RawTrade = Record<TextField, string | null>

/** What the model reports for a document. */
export interface RawTradeDocument {
  /** False when the document is not a contract note, confirmation, or statement of trades. */
  is_trade_document: boolean
  trades: RawTrade[]
}

/** One trade, shaped for the client to turn into a draft. */
export interface TradeExtraction {
  /** Column-shaped values; a field the document did not show, or that could not be read, is null. */
  fields: Record<ExtractedField, string | number | null>
  /** The literal text read for each field, so the form can show what was seen. */
  text: RawTrade
  /** `fields` keys the document did not show. */
  missing: ExtractedField[]
  /** `fields` keys whose text was read but could not be converted safely. */
  unreadable: ExtractedField[]
}

/** Trims a reported value to text, or null when absent, ill-typed, or a placeholder. */
function readText(raw: unknown): string | null {
  // A non-string is indistinguishable from absent on purpose: a number the model
  // computed is exactly what this feature must not trust.
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return isPlaceholder(text) ? null : text
}

/**
 * Reads a tool-call input into the document, or `null` when the response is not
 * a usable extraction. Only a missing or non-boolean `is_trade_document` makes
 * it unusable; every field degrades to null, never to a guess.
 */
export function readRawFields(input: unknown): RawTradeDocument | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  if (typeof record.is_trade_document !== 'boolean') return null

  const items = Array.isArray(record.trades) ? record.trades : []
  const trades: RawTrade[] = []
  for (const item of items.slice(0, MAX_TRADES)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const trade = {} as RawTrade
    for (const name of TEXT_FIELDS) trade[name] = readText(raw[name])
    trades.push(trade)
  }
  return { is_trade_document: record.is_trade_document, trades }
}

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,14}$/
const UNITS = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,6})?$/
const BUY_WORDS = new Set(['buy', 'bought', 'b', 'purchase', 'purchased'])
const SELL_WORDS = new Set(['sell', 'sold', 's', 'sale'])

/** An upper-case ticker, or null when the text is not shaped like one. */
export function parseTicker(raw: string | null): string | null {
  const text = raw?.replace(/\s/g, '').toUpperCase() ?? ''
  return TICKER.test(text) ? text : null
}

/** `buy` or `sell` for the words a contract note uses, null for anything else. */
export function parseSide(raw: string | null): 'buy' | 'sell' | null {
  const text = raw?.trim().toLowerCase() ?? ''
  if (BUY_WORDS.has(text)) return 'buy'
  if (SELL_WORDS.has(text)) return 'sell'
  return null
}

/** Positive units to at most six decimal places, or null when the text is not exactly that. */
export function parseUnits(raw: string | null): number | null {
  const text = raw?.replace(/\s/g, '') ?? ''
  if (!UNITS.test(text)) return null
  const units = Number(text.replaceAll(',', ''))
  return units > 0 ? units : null
}

/**
 * A non-negative amount in integer cents. Trailing zeros beyond the cents
 * (`98.5000`) are dropped; a price with real sub-cent digits cannot be held in
 * whole cents and is null rather than rounded.
 */
export function parseNonNegativeCents(raw: string | null): number | null {
  const cents = parseCents(raw?.replace(/(\.\d{2})0+$/, '$1') ?? null)
  return cents !== null && cents >= 0 ? cents : null
}

function shapeTrade(raw: RawTrade): TradeExtraction {
  const fields = {} as TradeExtraction['fields']
  const missing: ExtractedField[] = []
  const unreadable: ExtractedField[] = []

  const record = (
    key: ExtractedField,
    source: string | null,
    value: string | number | null,
  ) => {
    fields[key] = value
    if (value !== null) return
    // Text we read but could not convert is a likely misread the member should
    // see; no text at all is simply a field the document does not show.
    if (source === null) missing.push(key)
    else unreadable.push(key)
  }

  record('ticker', raw.ticker, parseTicker(raw.ticker))
  record('side', raw.side, parseSide(raw.side))
  record('traded_on', raw.trade_date, parseIsoDate(raw.trade_date))
  record('units', raw.units, parseUnits(raw.units))
  record('price_per_unit_cents', raw.price_per_unit, parseNonNegativeCents(raw.price_per_unit))
  record('fee_cents', raw.brokerage_fee, parseNonNegativeCents(raw.brokerage_fee))

  return { fields, text: raw, missing, unreadable }
}

/** Shapes the model's reported text into one extraction per trade. */
export function toExtractions(raw: RawTradeDocument): TradeExtraction[] {
  return raw.trades.map(shapeTrade)
}
