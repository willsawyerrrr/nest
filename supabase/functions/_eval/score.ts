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
import type { RiskItem } from './stats.ts'

/** What an engine produced for one document under one extractor. */
export interface RunResult {
  /** The raw fields in the extractor's own shape; absent when the run failed. */
  raw?: unknown
  /** Why the run failed, when it did. */
  error?: string
  /**
   * Set when the file could not be opened (`corrupt` or `encrypted`), so no
   * model ran. The app rejects such a file, so it scores as a decline.
   */
  unreadable?: string
  ms: number
  /** Tokens in the model's prompt, where the engine reports them. */
  promptTokens?: number
  /** A self-reported confidence from 0 to 1, where the engine was asked for one. */
  confidence?: number
  /** Whether the run paid model load and warm-up (`cold`) or not (`warm`), where the engine says. */
  timing?: 'cold' | 'warm'
  /** Every repeat of this run, the first being this result, where the engine writes them. */
  runs?: RunResult[]
}

/** An engine's results, keyed by `<doc id>:<extractor>`. */
export interface EngineResults {
  engine: string
  results: Record<string, RunResult>
  /** Every repeat of a run, keyed as `results` is; `results` holds the first. */
  repeats?: Record<string, RunResult[]>
}

/** Whether a parsed results file is an engine's results, as opposed to a run record. */
export function isEngineResults(file: unknown): file is EngineResults {
  if (typeof file !== 'object' || file === null) return false
  const { engine, results } = file as Record<string, unknown>
  return typeof engine === 'string' && typeof results === 'object' && results !== null
}

/**
 * Reads an engine's results file. A result carrying `runs`, as the Foundation
 * Models harness writes, has them fed into `repeats` so stability and timing
 * see every repeat; `results` keeps the result itself. Sampling modes are
 * separate files and so separate engines.
 */
export function readEngine(file: EngineResults): EngineResults {
  const repeats = { ...file.repeats }
  for (const [key, result] of Object.entries(file.results)) {
    if (result.runs?.length) repeats[key] ??= result.runs
  }
  return Object.keys(repeats).length === 0 ? file : { ...file, repeats }
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
 * declines it, as it does an unreadable file. A failed run scores none of its
 * units.
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
    const declined = run.unreadable !== undefined ||
      (run.raw !== undefined && !claimsKind(extractor, run.raw))
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

/** How one field, line or trade compares with its label. */
export type ErrorClass = 'correct' | 'missing' | 'wrong' | 'spurious' | 'format'

export interface FieldOutcome {
  /** The field's name; lines and trades are `<name>#<index>`, extras `<name>+<index>`. */
  field: string
  /** The impact weight of what the field feeds downstream. */
  weight: number
  /**
   * `correct` includes a field printed nowhere that came back empty; `missing`
   * is a printed field left empty; `wrong` and `spurious` are values the app
   * would pre-fill that are not the label's; `format` is text read that could
   * not be converted, so the app leaves the field empty.
   */
  cls: ErrorClass
  /** The app would pre-fill a value here. */
  filled: boolean
  /** A wrong amount, gross, tax withheld, units, price or side, or a money error over 1% or with the wrong sign. */
  severe: boolean
  /** The shaped value, for agreement across repeats and arms. */
  value: string | null
  /** A wrong money value within one cent of the label. */
  withinCent?: boolean
  /** Token F1 of a wrong description. */
  f1?: number
}

/** What an engine did with one document under one extractor. */
export interface RunOutcome {
  docId: string
  kind: DocKind
  extractor: DocKind
  /** The source document the variant was made from; clusters the bootstrap. */
  source: string
  /** `declined` is an answer the app rejects as not the extractor's kind. */
  status: 'answered' | 'declined' | 'failed'
  /** Empty unless the document is of the extractor's kind. */
  fields: FieldOutcome[]
  ms: number
  confidence?: number
}

const RECEIPT_WEIGHTS: Record<string, number> = {
  amount_cents: 5,
  deduction_date: 3,
  description: 1,
}
const PAYSLIP_WEIGHTS: Record<string, number> = {
  gross_cents: 5,
  tax_withheld_cents: 5,
  paid_on: 4,
  super_cents: 3,
  salary_sacrifice_cents: 3,
  net_cents: 2,
  period_start: 2,
  period_end: 2,
  ytd_gross_cents: 2,
  ytd_tax_withheld_cents: 2,
  ytd_super_cents: 2,
}
const PAYSLIP_LINE_WEIGHT = 3
const TRADE_SEVERE = ['ticker', 'side', 'units', 'price_per_unit_microdollars']
/** A trade is one unit weighing its fields: ticker, side, units and price 5, date 4, brokerage 2. */
const TRADE_WEIGHT = 26

type Severity = 'always' | 'money' | 'never'

interface FieldSpec {
  field: string
  weight: number
  severity: Severity
  want: string | number | null
  got: string | number | null
  /** The text was read but could not be converted. */
  unreadable: boolean
  /** Matched by containment, not equality. */
  text?: boolean
}

/** Whether a money error is over 1% of the printed value or has the wrong sign. */
function moneySevere(want: unknown, got: unknown): boolean {
  if (typeof want !== 'number' || typeof got !== 'number') return false
  return Math.abs(got - want) > 0.01 * Math.abs(want) || Math.sign(got) !== Math.sign(want)
}

/** Token F1 between two descriptions, ignoring case and punctuation. */
export function tokenF1(expected: string, actual: string): number {
  const [e, a] = [
    normalise(expected).split(' ').filter(Boolean),
    normalise(actual).split(' ').filter(Boolean),
  ]
  if (e.length === 0 || a.length === 0) return e.length === a.length ? 1 : 0
  const remaining = new Map<string, number>()
  for (const token of e) remaining.set(token, (remaining.get(token) ?? 0) + 1)
  let shared = 0
  for (const token of a) {
    const left = remaining.get(token) ?? 0
    if (left > 0) {
      remaining.set(token, left - 1)
      shared++
    }
  }
  return shared === 0 ? 0 : (2 * shared) / (e.length + a.length)
}

const outcome = (
  field: string,
  weight: number,
  cls: ErrorClass,
  got: unknown,
  extra: Partial<FieldOutcome> = {},
): FieldOutcome => ({
  field,
  weight,
  cls,
  filled: cls === 'correct' || cls === 'wrong' || cls === 'spurious' ? got !== null : false,
  severe: false,
  value: got === null || got === undefined ? null : String(got),
  ...extra,
})

function classify(spec: FieldSpec): FieldOutcome {
  const { field, weight, want, got } = spec
  if (want === null) {
    return got === null
      ? outcome(field, weight, 'correct', got)
      : outcome(field, weight, 'spurious', got, { severe: spec.severity === 'always' })
  }
  if (got === null) return outcome(field, weight, spec.unreadable ? 'format' : 'missing', got)
  if (spec.text ? descriptionMatches(want, got) : want === got) {
    return outcome(field, weight, 'correct', got)
  }
  return outcome(field, weight, 'wrong', got, {
    severe: spec.severity === 'always' || (spec.severity === 'money' && moneySevere(want, got)),
    ...(typeof want === 'number' && typeof got === 'number'
      ? { withinCent: Math.abs(got - want) <= 1 }
      : {}),
    ...(spec.text ? { f1: tokenF1(String(want), String(got)) } : {}),
  })
}

interface UnitSpec<T> {
  prefix: string
  weight: number
  want: T[]
  got: T[]
  key: (item: T) => string
  severe: (want: T, got: T) => boolean
  /** How alike two unmatched items are, to pair a wrong one with its label. */
  alike?: (want: T, got: T) => number
}

/**
 * Matches lines or trades as a multiset. An expected unit with no equal answer is
 * paired with the most alike unmatched answer as wrong, then missing; answers
 * left over are spurious.
 */
function matchUnits<T>(spec: UnitSpec<T>): FieldOutcome[] {
  const { prefix, weight, want, got, key, severe, alike = () => 0 } = spec
  const unmatchedGot = new Set(got.keys())
  const matched = want.map((item) => {
    for (const j of unmatchedGot) {
      if (key(got[j]) === key(item)) {
        unmatchedGot.delete(j)
        return j
      }
    }
    return -1
  })
  return [
    ...want.map((item, i) => {
      const field = `${prefix}#${i}`
      if (matched[i] >= 0) return outcome(field, weight, 'correct', key(item))
      let best = -1
      for (const j of unmatchedGot) {
        if (best < 0 || alike(item, got[j]) > alike(item, got[best])) best = j
      }
      if (best < 0) return outcome(field, weight, 'missing', null)
      unmatchedGot.delete(best)
      return outcome(field, weight, 'wrong', key(got[best]), { severe: severe(item, got[best]) })
    }),
    ...[...unmatchedGot].map((j, n) =>
      outcome(`${prefix}+${n}`, weight, 'spurious', key(got[j]), { severe: false })
    ),
  ]
}

function receiptOutcomes(actual: RawDeductionFields, label: RawDeductionFields): FieldOutcome[] {
  const [got, want] = [toDeduction(actual), toDeduction(label)]
  return (Object.keys(want.fields) as (keyof typeof want.fields)[]).map((key) =>
    classify({
      field: key,
      weight: RECEIPT_WEIGHTS[key] ?? 1,
      severity: key === 'amount_cents' ? 'always' : 'never',
      want: want.fields[key],
      got: got.fields[key],
      unreadable: got.unreadable.includes(key),
      text: key === 'description',
    })
  )
}

function payslipOutcomes(actual: RawPayslipFields, label: RawPayslipFields): FieldOutcome[] {
  const [got, want] = [toPayslip(actual), toPayslip(label)]
  const fields = (Object.keys(want.fields) as (keyof typeof want.fields)[]).map((key) =>
    classify({
      field: key,
      weight: PAYSLIP_WEIGHTS[key] ?? 2,
      severity: key === 'gross_cents' || key === 'tax_withheld_cents'
        ? 'always'
        : key.endsWith('_cents')
        ? 'money'
        : 'never',
      want: want.fields[key],
      got: got.fields[key],
      unreadable: got.unreadable.includes(key),
    })
  )
  type Line = { amount_cents: number | null; component?: string | null }
  const amountSevere = (w: Line, g: Line) => moneySevere(w.amount_cents, g.amount_cents)
  return [
    ...fields,
    ...matchUnits<Line>({
      prefix: 'earnings_lines',
      weight: PAYSLIP_LINE_WEIGHT,
      want: want.lines.earnings,
      got: got.lines.earnings,
      key: (line) => String(line.amount_cents),
      severe: amountSevere,
    }),
    ...matchUnits<Line>({
      prefix: 'tax_lines',
      weight: PAYSLIP_LINE_WEIGHT,
      want: want.lines.tax,
      got: got.lines.tax,
      key: (line) => `${line.amount_cents}/${line.component}`,
      severe: amountSevere,
    }),
  ]
}

function tradeOutcomes(actual: RawTradeDocument, label: RawTradeDocument): FieldOutcome[] {
  type Fields = Record<string, string | number | null>
  const shape = (doc: RawTradeDocument): Fields[] => toTrades(doc).map((trade) => trade.fields)
  return matchUnits<Fields>({
    prefix: 'trades',
    weight: TRADE_WEIGHT,
    want: shape(label),
    got: shape(actual),
    key: (trade) => JSON.stringify(trade),
    severe: (want, got) =>
      TRADE_SEVERE.some((name) => want[name] !== got[name]) ||
      moneySevere(want.fee_cents, got.fee_cents),
    alike: (want, got) => Object.keys(want).filter((name) => want[name] === got[name]).length,
  })
}

/** The source document a corpus variant was made from, defaulting to the document itself. */
export const sourceOf = (doc: CorpusDoc & { source?: string }): string => doc.source ?? doc.id

/** Every unit of a document's label, none of it answered. */
function unanswered(doc: Exclude<CorpusDoc, { kind: 'other' }>): FieldOutcome[] {
  const empty = doc.kind === 'trade'
    ? tradeOutcomes({ is_trade_document: true, trades: [] }, doc.label)
    : doc.kind === 'payslip'
    ? payslipOutcomes({ ...NO_FIELDS, is_payslip: false }, doc.label)
    : receiptOutcomes({
      is_receipt: false,
      not_receipt_reason: null,
      description: null,
      deduction_date: null,
      amount: null,
    }, doc.label)
  return empty.map((unit) => ({ ...unit, cls: 'missing', severe: false, filled: false }))
}

/**
 * Scores one run field by field. A run the app would reject as not the
 * extractor's kind or whose file could not be opened (`declined`) and a run
 * that failed or could not be read (`failed`) answer none of a document's units, so each is missing.
 */
export function outcomeOf(
  doc: CorpusDoc & { source?: string },
  extractor: DocKind,
  run: RunResult,
  options: { printedDates?: boolean } = {},
): RunOutcome {
  if (options.printedDates && run.raw !== undefined) {
    run = { ...run, raw: acceptPrintedDates(run.raw) }
  }
  const base = {
    docId: doc.id,
    kind: doc.kind,
    extractor,
    source: sourceOf(doc),
    ms: run.ms,
    ...(run.confidence === undefined ? {} : { confidence: run.confidence }),
  }
  const target = doc.kind === extractor && doc.kind !== 'other' ? doc : null
  if (run.unreadable !== undefined) {
    return { ...base, status: 'declined', fields: target ? unanswered(target) : [] }
  }
  const read = run.raw === undefined ? null : readAnswer(extractor, run.raw)
  if (read === null) {
    return { ...base, status: 'failed', fields: target ? unanswered(target) : [] }
  }
  if (!claimsKind(extractor, run.raw)) {
    return { ...base, status: 'declined', fields: target ? unanswered(target) : [] }
  }
  if (!target) return { ...base, status: 'answered', fields: [] }
  const fields = target.kind === 'payslip'
    ? payslipOutcomes(read as RawPayslipFields, target.label)
    : target.kind === 'deduction'
    ? receiptOutcomes(read as RawDeductionFields, target.label)
    : tradeOutcomes(read as RawTradeDocument, target.label)
  return { ...base, status: 'answered', fields }
}

function readAnswer(extractor: DocKind, raw: unknown): unknown {
  switch (extractor) {
    case 'payslip':
      return readPayslip(raw)
    case 'deduction':
      return readDeduction(raw)
    case 'trade':
      return readTrades(raw)
    case 'other':
      return null
  }
}

/** Totals over the runs of one extractor. */
export interface Summary {
  runs: number
  failed: number
  declined: number
  /** Impact weight of every unit, and of those correct. */
  weight: number
  correctWeight: number
  /** Impact-weighted exact-match rate. */
  accuracy: number
  classes: Record<ErrorClass, number>
  /** Fields the app would pre-fill. */
  filled: number
  /** Filled and wrong or spurious: nothing in the app's checks stops them. */
  wrongConfident: number
  severe: number
  /** Wrong money values within one cent of the label. */
  withinCent: number
  /** Mean token F1 of wrong descriptions; null when there were none. */
  meanF1: number | null
}

/** Summarises outcomes; the unit counts come only from documents of the extractor's kind. */
export function summarise(outcomes: RunOutcome[]): Summary {
  const classes: Record<ErrorClass, number> = {
    correct: 0,
    missing: 0,
    wrong: 0,
    spurious: 0,
    format: 0,
  }
  let [weight, correctWeight, filled, severe, withinCent] = [0, 0, 0, 0, 0]
  const f1: number[] = []
  for (const run of outcomes) {
    for (const unit of run.fields) {
      weight += unit.weight
      if (unit.cls === 'correct') correctWeight += unit.weight
      classes[unit.cls]++
      if (unit.filled) filled++
      if (unit.severe) severe++
      if (unit.withinCent) withinCent++
      if (unit.f1 !== undefined) f1.push(unit.f1)
    }
  }
  return {
    runs: outcomes.length,
    failed: outcomes.filter((run) => run.status === 'failed').length,
    declined: outcomes.filter((run) => run.status === 'declined').length,
    weight,
    correctWeight,
    accuracy: weight === 0 ? 0 : correctWeight / weight,
    classes,
    filled,
    wrongConfident: classes.wrong + classes.spurious,
    severe,
    withinCent,
    meanF1: f1.length === 0 ? null : f1.reduce((a, b) => a + b, 0) / f1.length,
  }
}

/**
 * How well an engine told documents apart: the share of documents of another
 * kind it declined, and the share of documents of the extractor's kind it
 * declined. Failed runs are neither.
 */
export function declineStats(outcomes: RunOutcome[]): {
  negatives: number
  declinedNegatives: number
  positives: number
  declinedPositives: number
} {
  const answered = outcomes.filter((run) => run.status !== 'failed')
  const [positive, negative] = [
    answered.filter((run) => run.kind === run.extractor),
    answered.filter((run) => run.kind !== run.extractor),
  ]
  return {
    negatives: negative.length,
    declinedNegatives: negative.filter((run) => run.status === 'declined').length,
    positives: positive.length,
    declinedPositives: positive.filter((run) => run.status === 'declined').length,
  }
}

/**
 * Field agreement over repeats of one document: for each field, the share of
 * repeats giving the commonest value, averaged over fields. Null below two repeats.
 */
export function stability(repeats: RunOutcome[]): number | null {
  if (repeats.length < 2) return null
  const names = new Set(repeats.flatMap((run) => run.fields.map((unit) => unit.field)))
  if (names.size === 0) return null
  let total = 0
  for (const name of names) {
    const counts = new Map<string | null, number>()
    for (const run of repeats) {
      const value = run.fields.find((unit) => unit.field === name)?.value ?? null
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    total += Math.max(...counts.values()) / repeats.length
  }
  return total / names.size
}

/**
 * Confidence from agreement: each run's fields against the same fields of the
 * others (repeats of one arm, or the same document under other arms), averaged.
 * Empty below two runs.
 */
export function agreementConfidence(group: RunOutcome[]): number[] {
  if (group.length < 2) return []
  return group.map((run, i) => {
    const others = group.filter((_, j) => j !== i)
    const names = run.fields.map((unit) => unit.field)
    if (names.length === 0) return 1
    let total = 0
    for (const unit of run.fields) {
      const agreeing = others.filter((other) =>
        (other.fields.find((o) =>
          o.field === unit.field
        )?.value ?? null) === unit.value
      ).length
      total += agreeing / others.length
    }
    return total / names.length
  })
}

/** Confidence from the app's own checks: every answered field converted, and the kind was claimed. */
export const validatorConfidence = (run: RunOutcome): number =>
  run.status === 'answered' && run.fields.every((unit) => unit.cls !== 'format') ? 1 : 0

/** A run as a point for a risk-coverage curve, ranked by `confidence`. */
export function riskItem(run: RunOutcome, confidence: number): RiskItem {
  const weight = run.fields.reduce((acc, unit) => acc + unit.weight, 0)
  const error = run.fields.reduce(
    (acc, unit) => acc + (unit.cls === 'correct' ? 0 : unit.weight),
    0,
  )
  return { confidence, error, weight }
}
