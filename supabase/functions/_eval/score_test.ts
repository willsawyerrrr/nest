import { assertEquals } from '@std/assert'
import { buildCorpus, type CorpusDoc } from './corpus.ts'
import { report } from './report.ts'
import { resultKey, scoreRun } from './score.ts'

const corpus = buildCorpus()
const find = (id: string): CorpusDoc => corpus.find((doc) => doc.id === id)!

Deno.test('the corpus has a label for every document kind and unique ids', () => {
  assertEquals(new Set(corpus.map((doc) => doc.id)).size, corpus.length)
  for (const kind of ['payslip', 'deduction', 'trade', 'other']) {
    assertEquals(corpus.some((doc) => doc.kind === kind), true)
  }
})

Deno.test('a label scores full marks against itself', () => {
  for (const doc of corpus) {
    if (doc.kind === 'other') continue
    const score = scoreRun(doc, doc.kind, { raw: doc.label, ms: 1 })
    assertEquals(score.correct, score.units, doc.id)
    assertEquals(score.spurious, 0, doc.id)
  }
})

Deno.test('a year-to-date-only row counted as a line of this pay is spurious', () => {
  const doc = find('payslip-4')
  if (doc.kind !== 'payslip') throw new Error('unexpected kind')
  const raw = structuredClone(doc.label)
  raw.earnings_lines = raw.earnings_lines.map((line) => ({
    ...line,
    period_amount: line.period_amount ?? line.ytd_amount,
  }))
  const score = scoreRun(doc, 'payslip', { raw, ms: 1 })
  assertEquals(score.spurious, 1)
})

Deno.test('a misread trade price loses the whole trade', () => {
  const doc = find('trades-1')
  if (doc.kind !== 'trade') throw new Error('unexpected kind')
  const raw = structuredClone(doc.label)
  raw.trades[0].price_per_unit = '$1.0000'
  const score = scoreRun(doc, 'trade', { raw, ms: 1 })
  assertEquals([score.units, score.correct, score.spurious], [
    doc.label.trades.length,
    doc.label.trades.length - 1,
    1,
  ])
})

Deno.test('a failed run scores none of its units, and declining an unrelated document scores', () => {
  const doc = find('receipt-1')
  assertEquals(scoreRun(doc, 'deduction', { error: 'api_error', ms: 1 }).correct, 0)
  const other = find('other-letter')
  assertEquals(scoreRun(other, 'payslip', { raw: { is_payslip: false }, ms: 1 }).correct, 1)
  assertEquals(scoreRun(other, 'payslip', { raw: { is_payslip: true }, ms: 1 }).correct, 0)
  assertEquals(
    scoreRun(other, 'trade', { raw: { is_trade_document: true, trades: [] }, ms: 1 }).correct,
    1,
  )
})

Deno.test('the report lists one row per engine and extractor', () => {
  const doc = find('receipt-1')
  if (doc.kind !== 'deduction') throw new Error('unexpected kind')
  const table = report(corpus, [{
    engine: 'stub',
    results: {
      [resultKey('receipt-1', 'deduction')]: { raw: doc.label, ms: 5, promptTokens: 300 },
    },
  }])
  assertEquals(table.split('\n').length, 3)
  assertEquals(
    table.includes('| stub | deduction | 3/3 (100%) | 3/3 (100%) | 0 | 0/1 | 5 | 300 |'),
    true,
  )
})

Deno.test('printed DD/MM/YYYY dates score only when accepted', () => {
  const doc = find('receipt-1')
  if (doc.kind !== 'deduction') throw new Error('unexpected kind')
  const [y, m, d] = doc.label.deduction_date!.split('-')
  const raw = { ...doc.label, deduction_date: `${d}/${m}/${y}` }
  assertEquals(scoreRun(doc, 'deduction', { raw, ms: 1 }).correct, 2)
  assertEquals(scoreRun(doc, 'deduction', { raw, ms: 1 }, { printedDates: true }).correct, 3)
})
