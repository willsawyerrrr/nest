/**
 * The client half of trade extraction: the shape the `trade-extract` edge
 * function answers with, and the reading of its failures into the message the
 * import panel shows.
 *
 * Nothing here writes a trade. Extraction only ever yields drafts — the member
 * confirms, edits, or discards each one, and their own save is what persists —
 * so a failure at any point leaves manual entry exactly as it was.
 */

import type { TradeFormValues } from '../hooks/useTrades'

/** The trade fields extraction reads, keyed as the `trade` columns are. */
const FIELD_LABELS = {
  ticker: 'ticker',
  side: 'side',
  traded_on: 'date',
  units: 'units',
  price_per_unit_cents: 'price per unit',
  fee_cents: 'brokerage fee',
} as const

type ExtractedField = keyof typeof FIELD_LABELS

/** One trade read from a document, as a draft's form starts from it. */
export interface ExtractedTrade {
  /** Column-shaped values; a field the document did not give, or that could not be read, is absent. */
  values: TradeFormValues
  /** Labels of the fields the member should fill in or check: not shown, or read but unusable. */
  check: string[]
}

/** How reading a document ended: its trades, or the reason it could not be read. */
export type ExtractionOutcome =
  { status: 'read'; trades: ExtractedTrade[] } | { status: 'failed'; message: string }

/** What the panel says when a failure carried no message of its own. */
export const EXTRACTION_FAILED_MESSAGE = 'Could not read this document. Enter the trades by hand.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The labels of `keys` that are extraction fields. */
function labels(keys: unknown): string[] {
  return Array.isArray(keys)
    ? keys.filter((key): key is ExtractedField => key in FIELD_LABELS).map((k) => FIELD_LABELS[k])
    : []
}

function readTrade(raw: unknown): ExtractedTrade | null {
  if (!isRecord(raw) || !isRecord(raw.fields)) {
    return null
  }
  const fields = raw.fields
  const values: TradeFormValues = {}
  if (typeof fields.ticker === 'string') {
    values.ticker = fields.ticker
  }
  if (fields.side === 'buy' || fields.side === 'sell') {
    values.side = fields.side
  }
  if (typeof fields.traded_on === 'string') {
    values.traded_on = fields.traded_on
  }
  if (typeof fields.units === 'number' && fields.units > 0) {
    values.units = fields.units
  }
  if (typeof fields.price_per_unit_cents === 'number' && fields.price_per_unit_cents >= 0) {
    values.price_per_unit_cents = fields.price_per_unit_cents
  }
  if (typeof fields.fee_cents === 'number' && fields.fee_cents >= 0) {
    values.fee_cents = fields.fee_cents
  }
  // A brokerage fee the document does not show is nil, not something to chase.
  const absentFee = labels(raw.missing).filter((label) => label !== FIELD_LABELS.fee_cents)
  return { values, check: [...absentFee, ...labels(raw.unreadable)] }
}

/**
 * Reads a successful reply into the trades the panel drafts from, or null when
 * the body is not one. The body comes from the household's own edge function,
 * but it is still read rather than trusted.
 */
export function readExtraction(body: unknown): ExtractedTrade[] | null {
  if (!isRecord(body) || typeof body.model !== 'string' || !Array.isArray(body.trades)) {
    return null
  }
  const trades = body.trades.map(readTrade)
  return trades.every((trade) => trade !== null) ? trades : null
}

/**
 * Reads a non-2xx body into the failure the panel shows. The function's own
 * message is used only when it came with a stable `code`: that is fixed copy of
 * ours, whereas a body without one (a gateway or network failure, or an internal
 * message) gets the plain fallback.
 */
export function readExtractionFailure(body: unknown): { status: 'failed'; message: string } {
  const message =
    isRecord(body) && typeof body.code === 'string' && typeof body.error === 'string'
      ? body.error
      : EXTRACTION_FAILED_MESSAGE
  return { status: 'failed', message }
}
