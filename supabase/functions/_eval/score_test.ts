import { assertEquals } from '@std/assert'
import { buildCorpus, type CorpusDoc } from './corpus.ts'
import { decisionMatrix, diagnostics, evaluate, report } from './report.ts'
import {
  agreementConfidence,
  declineStats,
  outcomeOf,
  resultKey,
  scoreRun,
  stability,
  summarise,
  tokenF1,
  validatorConfidence,
} from './score.ts'

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

const receipt = (id: string) => {
  const doc = find(id)
  if (doc.kind !== 'deduction') throw new Error('unexpected kind')
  return doc
}

Deno.test('a label is all correct under every extractor and weighs fields by impact', () => {
  for (const doc of corpus) {
    if (doc.kind === 'other') continue
    const run = outcomeOf(doc, doc.kind, { raw: doc.label, ms: 1 })
    assertEquals(run.status, 'answered', doc.id)
    assertEquals(run.fields.every((unit) => unit.cls === 'correct' && !unit.severe), true, doc.id)
  }
  const fields = outcomeOf(receipt('receipt-1'), 'deduction', {
    raw: receipt('receipt-1').label,
    ms: 1,
  }).fields
  assertEquals(
    Object.fromEntries(fields.map((unit) => [unit.field, unit.weight])),
    { description: 1, deduction_date: 3, amount_cents: 5 },
  )
})

Deno.test('a field printed nowhere is correct empty and spurious when filled', () => {
  const doc = corpus.find((d) => d.kind === 'payslip' && d.label.super === null)
  if (!doc || doc.kind !== 'payslip') throw new Error('no payslip without super')
  const unit = (raw: object) =>
    outcomeOf(doc, 'payslip', { raw, ms: 1 }).fields.find((u) => u.field === 'super_cents')!
  assertEquals([unit(doc.label).cls, unit(doc.label).filled], ['correct', false])
  const filled = outcomeOf(doc, 'payslip', { raw: { ...doc.label, super: '$10.00' }, ms: 1 })
  const spurious = filled.fields.find((u) => u.field === 'super_cents')!
  assertEquals([spurious.cls, spurious.filled], ['spurious', true])
  assertEquals(summarise([filled]).wrongConfident, 1)
})

Deno.test('error classes: missing, format, wrong, and printed dates accepted', () => {
  const doc = receipt('receipt-1')
  const cls = (raw: object, options = {}) =>
    Object.fromEntries(
      outcomeOf(doc, 'deduction', { raw: { ...doc.label, ...raw }, ms: 1 }, options).fields.map((
        u,
      ) => [u.field, u.cls]),
    )
  assertEquals(cls({ amount: null }).amount_cents, 'missing')
  assertEquals(cls({ amount: 'about ten' }).amount_cents, 'format')
  assertEquals(cls({ amount: '$0.01' }).amount_cents, 'wrong')
  const [y, m, d] = doc.label.deduction_date!.split('-')
  const printed = { deduction_date: `${d}/${m}/${y}` }
  assertEquals(cls(printed).deduction_date, 'format')
  assertEquals(cls(printed, { printedDates: true }).deduction_date, 'correct')
})

Deno.test('a wrong amount is severe, a one-cent miss is flagged as rounding', () => {
  const doc = receipt('receipt-1')
  const cents = Number(String(doc.label.amount).replace(/[^0-9]/g, ''))
  const amount = (n: number) => `$${(n / 100).toFixed(2)}`
  const unit = (n: number) =>
    outcomeOf(doc, 'deduction', { raw: { ...doc.label, amount: amount(n) }, ms: 1 }).fields.find((
      u,
    ) => u.field === 'amount_cents')!
  assertEquals([unit(cents + 1).severe, unit(cents + 1).withinCent], [true, true])
  assertEquals(unit(cents * 3).withinCent, false)
})

Deno.test('a money error is severe only over 1% or with the wrong sign', () => {
  const doc = find('payslip-1')
  if (doc.kind !== 'payslip') throw new Error('unexpected kind')
  const net = (raw: string) =>
    outcomeOf(doc, 'payslip', { raw: { ...doc.label, net: raw }, ms: 1 }).fields.find((u) =>
      u.field === 'net_cents'
    )!
  const cents = Number(doc.label.net!.replace(/[^0-9]/g, ''))
  const dollars = (n: number) => `$${(n / 100).toFixed(2)}`
  assertEquals(net(dollars(Math.round(cents * 1.005))).severe, false)
  assertEquals(net(dollars(Math.round(cents * 1.05))).severe, true)
  const gross = outcomeOf(doc, 'payslip', { raw: { ...doc.label, gross: '$1.00' }, ms: 1 }).fields
    .find((u) => u.field === 'gross_cents')!
  assertEquals([gross.cls, gross.severe, gross.weight], ['wrong', true, 5])
})

Deno.test('payslip lines pair a misread amount as wrong and count extras as spurious', () => {
  const doc = find('payslip-4')
  if (doc.kind !== 'payslip') throw new Error('unexpected kind')
  const raw = structuredClone(doc.label)
  raw.earnings_lines[0].period_amount = '$1.00'
  raw.earnings_lines.push({ label: 'Bonus', period_amount: '$5.00', ytd_amount: null })
  const lines = outcomeOf(doc, 'payslip', { raw, ms: 1 }).fields.filter((u) =>
    u.field.startsWith('earnings_lines')
  )
  assertEquals(lines[0].cls, 'wrong')
  assertEquals(lines[0].weight, 3)
  assertEquals(lines.at(-1)?.cls, 'spurious')
})

Deno.test('a misread trade price is a severe wrong trade; a dropped trade is missing', () => {
  const doc = find('trades-1')
  if (doc.kind !== 'trade') throw new Error('unexpected kind')
  const raw = structuredClone(doc.label)
  raw.trades[0].price_per_unit = '$1.0000'
  const wrong = outcomeOf(doc, 'trade', { raw, ms: 1 })
  assertEquals(wrong.fields[0].cls, 'wrong')
  assertEquals(wrong.fields[0].severe, true)
  assertEquals(summarise([wrong]).wrongConfident, 1)
  const dropped = outcomeOf(doc, 'trade', {
    raw: { ...doc.label, trades: doc.label.trades.slice(1) },
    ms: 1,
  })
  assertEquals(dropped.fields.filter((u) => u.cls === 'missing').length, 1)
})

Deno.test('declined real documents and failed runs answer nothing; declines are tallied', () => {
  const doc = receipt('receipt-1')
  const declined = outcomeOf(doc, 'deduction', { raw: { ...doc.label, is_receipt: false }, ms: 1 })
  assertEquals([declined.status, summarise([declined]).accuracy], ['declined', 0])
  const failed = outcomeOf(doc, 'deduction', { error: 'api_error', ms: 1 })
  assertEquals(failed.status, 'failed')
  assertEquals(failed.fields.every((u) => u.cls === 'missing' && !u.filled), true)
  const other = find('other-letter')
  const runs = [
    outcomeOf(other, 'payslip', { raw: { is_payslip: false }, ms: 1 }),
    outcomeOf(other, 'payslip', { raw: { is_payslip: true }, ms: 1 }),
    outcomeOf(other, 'payslip', { error: 'x', ms: 1 }),
  ]
  assertEquals(declineStats(runs), {
    negatives: 2,
    declinedNegatives: 1,
    positives: 0,
    declinedPositives: 0,
  })
})

Deno.test('token F1 scores partial descriptions', () => {
  assertEquals(tokenF1('Acme Hardware', 'acme hardware'), 1)
  assertEquals(tokenF1('Acme Hardware', 'Acme'), 2 / 3)
  assertEquals(tokenF1('Acme', 'Bolt'), 0)
})

Deno.test('stability and agreement measure field agreement over repeats', () => {
  const doc = receipt('receipt-1')
  const run = (raw: object) => outcomeOf(doc, 'deduction', { raw: { ...doc.label, ...raw }, ms: 1 })
  const same = [run({}), run({}), run({})]
  assertEquals(stability(same), 1)
  assertEquals(stability(same.slice(0, 1)), null)
  const drift = [run({}), run({}), run({ amount: '$0.01' })]
  assertEquals(stability(drift), (1 + 1 + 2 / 3) / 3)
  const agreement = agreementConfidence(drift)
  assertEquals(agreement[0] > agreement[2], true)
  assertEquals(validatorConfidence(run({ amount: 'about ten' })), 0)
  assertEquals(validatorConfidence(run({})), 1)
})

Deno.test('the decision matrix names failed and unmeasured gates and scores only passing arms', () => {
  const docs = corpus.filter((d) => d.kind === 'deduction')
  const raws = (mutate: (label: Record<string, unknown>) => object) =>
    Object.fromEntries(docs.map((d) => {
      if (d.kind !== 'deduction') throw new Error('unexpected kind')
      return [resultKey(d.id, 'deduction'), { raw: mutate({ ...d.label }), ms: 100 }]
    }))
  const engines = [
    { engine: 'haiku-pdf', results: raws((l) => l) },
    { engine: 'device', results: raws((l) => ({ ...l, amount: '$0.01' })) },
  ]
  const rows = evaluate(corpus, engines, { baseline: 'haiku-pdf', resamples: 200 })
  const device = rows.deduction.find((r) => r.engine === 'device')!
  assertEquals(device.gates.find((g) => g.name === 'accuracy')?.status, 'fail')
  assertEquals(device.gates.find((g) => g.name === 'severe')?.status, 'fail')
  assertEquals(device.score, null)
  const base = rows.deduction.find((r) => r.engine === 'haiku-pdf')!
  // Fifteen filled fields cannot bound the rate under 2% even with no errors.
  assertEquals(base.summary.wrongConfident, 0)
  assertEquals(base.gates.find((g) => g.name === 'wrong-confident')?.status, 'fail')
  assertEquals(base.gates.find((g) => g.name === 'stability')?.status, 'unmeasured')
  const text = decisionMatrix(corpus, engines, { baseline: 'haiku-pdf', resamples: 200 })
  assertEquals(text.includes('### Receipt'), true)
  assertEquals(text.includes('stability?'), true)
  assertEquals(diagnostics(corpus, engines).split('\n').length >= 4, true)
})
