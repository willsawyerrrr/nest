/**
 * Scores an engine's raw extraction against a corpus label.
 *
 * Both are shaped through the edge functions' own `toExtraction`s, so a figure
 * counts as right exactly when the app would pre-fill the same value: money in
 * cents, dates as ISO, prices in microdollars. A document is worth a number of
 * units (a field, a line, a trade); `correct` of them are matched and `spurious`
 * extras are reported without being subtracted, so a hallucinated row shows up
 * on its own.
 */

import {
  readRawFields as readDeduction,
  toExtraction as toDeduction,
} from '../deduction-extract/fields.ts'
import type { RawDeductionFields } from '../deduction-extract/fields.ts'
import {
  readRawFields as readPayslip,
  toExtraction as toPayslip,
} from '../payslip-extract/fields.ts'
import type { RawPayslipFields } from '../payslip-extract/fields.ts'
import { readRawFields as readTrades, toExtractions as toTrades } from '../trade-extract/fields.ts'
import type { RawTradeDocument } from '../trade-extract/fields.ts'
import { type CorpusDoc, type DocKind, NO_FIELDS } from './corpus.ts'

/** What an engine produced for one document under one extractor. */
export interface RunResult {
  /** The raw fields in the extractor's own shape; absent when the run failed. */
  raw?: unknown
  /** Why the run failed, when it did. */
  error?: string
  ms: number
  /** Tokens in the model's prompt, where the engine reports them. */
  promptTokens?: number
}

/** An engine's results, keyed by `<doc id>:<extractor>`. */
export interface EngineResults {
  engine: string
  results: Record<string, RunResult>
}

export interface Score {
  units: number
  correct: number
  spurious: number
}

const DATE_KEYS = new Set(['period_start', 'period_end', 'paid_on', 'deduction_date', 'trade_date'])

/**
 * Rewrites dates printed as `DD/MM/YYYY` to ISO, leaving everything else as it is.
 * An on-device path can convert printed dates in code, so this separates a model
 * misreading a date from it merely not following the ISO instruction.
 */
export function acceptPrintedDates(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => acceptPrintedDates(item))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, acceptPrintedDates(v, k)]),
    )
  }
  const match = typeof value === 'string' && DATE_KEYS.has(key)
    ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
    : null
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value
}

export const resultKey = (docId: string, extractor: DocKind): string => `${docId}:${extractor}`

const ZERO: Score = { units: 0, correct: 0, spurious: 0 }

/** Counts the multiset intersection of `actual` with `expected`. */
function matchMultiset(expected: string[], actual: string[]): Score {
  const remaining = new Map<string, number>()
  for (const key of expected) remaining.set(key, (remaining.get(key) ?? 0) + 1)
  let correct = 0
  let spurious = 0
  for (const key of actual) {
    const left = remaining.get(key) ?? 0
    if (left > 0) {
      remaining.set(key, left - 1)
      correct++
    } else spurious++
  }
  return { units: expected.length, correct, spurious }
}

const add = (a: Score, b: Score): Score => ({
  units: a.units + b.units,
  correct: a.correct + b.correct,
  spurious: a.spurious + b.spurious,
})

const fieldScore = (expected: unknown, actual: unknown): Score => ({
  units: 1,
  correct: expected === actual ? 1 : 0,
  spurious: 0,
})

const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** A description matches when either contains the other, ignoring case and punctuation. */
function descriptionMatches(expected: unknown, actual: unknown): boolean {
  if (expected === null || actual === null) return expected === actual
  const [e, a] = [normalise(String(expected)), normalise(String(actual))]
  return e === a || a.includes(e) || e.includes(a)
}

function scorePayslip(actual: RawPayslipFields, label: RawPayslipFields): Score {
  const [got, want] = [toPayslip(actual), toPayslip(label)]
  let score = ZERO
  for (const key of Object.keys(want.fields) as (keyof typeof want.fields)[]) {
    score = add(score, fieldScore(want.fields[key], got.fields[key]))
  }
  score = add(
    score,
    matchMultiset(
      want.lines.earnings.map((line) => String(line.amount_cents)),
      got.lines.earnings.map((line) => String(line.amount_cents)),
    ),
  )
  const taxKey = (line: { amount_cents: number | null; component: string | null }) =>
    `${line.amount_cents}/${line.component}`
  return add(score, matchMultiset(want.lines.tax.map(taxKey), got.lines.tax.map(taxKey)))
}

function scoreDeduction(actual: RawDeductionFields, label: RawDeductionFields): Score {
  const [got, want] = [toDeduction(actual).fields, toDeduction(label).fields]
  return add(
    add(
      fieldScore(want.deduction_date, got.deduction_date),
      fieldScore(want.amount_cents, got.amount_cents),
    ),
    {
      units: 1,
      correct: descriptionMatches(want.description, got.description) ? 1 : 0,
      spurious: 0,
    },
  )
}

function scoreTrades(actual: RawTradeDocument, label: RawTradeDocument): Score {
  const key = (doc: RawTradeDocument) => toTrades(doc).map((trade) => JSON.stringify(trade.fields))
  return matchMultiset(key(label), key(actual))
}

/** Whether the raw answer says the document is of the extractor's kind. */
function claimsKind(extractor: DocKind, raw: unknown): boolean {
  const record = raw as Record<string, unknown>
  switch (extractor) {
    case 'payslip':
      return record.is_payslip === true
    case 'deduction':
      return record.is_receipt === true
    case 'trade':
      return record.is_trade_document === true &&
        (record.trades as unknown[] | undefined)?.length !== 0
    case 'other':
      return false
  }
}

/**
 * Scores one run. A document of another kind is one unit: right when the engine
 * declines it. A failed run scores none of its units.
 */
export function scoreRun(
  doc: CorpusDoc,
  extractor: DocKind,
  run: RunResult,
  options: { printedDates?: boolean } = {},
): Score {
  if (options.printedDates && run.raw !== undefined) {
    run = { ...run, raw: acceptPrintedDates(run.raw) }
  }
  if (doc.kind !== extractor) {
    const declined = run.raw !== undefined && !claimsKind(extractor, run.raw)
    return { units: 1, correct: declined ? 1 : 0, spurious: 0 }
  }
  return doc.kind === 'other' ? ZERO : scoreExpected(doc, run.raw)
}

function scoreExpected(doc: Exclude<CorpusDoc, { kind: 'other' }>, raw: unknown): Score {
  // Read the answer as the edge function does, so a missing field is null and an
  // unusable answer scores nothing.
  switch (doc.kind) {
    case 'payslip': {
      const actual = readPayslip(raw)
      return actual ? scorePayslip(actual, doc.label) : unusable(doc)
    }
    case 'deduction': {
      const actual = readDeduction(raw)
      return actual ? scoreDeduction(actual, doc.label) : unusable(doc)
    }
    case 'trade': {
      const actual = readTrades(raw)
      return actual ? scoreTrades(actual, doc.label) : unusable(doc)
    }
  }
}

/** The units of a document whose answer could not be read: all missed. */
function unusable(doc: Exclude<CorpusDoc, { kind: 'other' }>): Score {
  const full = doc.kind === 'trade'
    ? scoreTrades({ is_trade_document: true, trades: [] }, doc.label)
    : doc.kind === 'payslip'
    ? scorePayslip({ ...NO_FIELDS, is_payslip: false }, doc.label)
    : scoreDeduction({
      is_receipt: false,
      not_receipt_reason: null,
      description: null,
      deduction_date: null,
      amount: null,
    }, doc.label)
  return { ...full, correct: 0 }
}
