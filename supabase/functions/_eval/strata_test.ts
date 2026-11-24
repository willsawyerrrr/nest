import { assert, assertEquals } from '@std/assert'
import { buildCorpus, type CorpusDoc } from './corpus.ts'
import { buildStrata, FORMATS, TARGETS, TRADE_COUNTS } from './strata.ts'

const strata = buildStrata()
const ofKind = <K extends CorpusDoc['kind']>(kind: K) =>
  strata.filter((doc): doc is Extract<CorpusDoc, { kind: K }> => doc.kind === kind)

Deno.test('the strata hit the target counts over the target sources', () => {
  for (const [kind, { documents, sources }] of Object.entries(TARGETS)) {
    const docs = strata.filter((doc) => doc.kind === kind)
    assertEquals(docs.length, documents, kind)
    assertEquals(new Set(docs.map((doc) => doc.source)).size, sources, kind)
  }
  assertEquals(new Set(strata.map((doc) => doc.id)).size, strata.length)
  assert(strata.every((doc) => doc.source && doc.stratum && doc.locale))
})

Deno.test('the strata are the same on every run and leave tier T0 as it was', () => {
  assertEquals(JSON.stringify(buildStrata()), JSON.stringify(strata))
  const t0 = buildCorpus()
  assertEquals(t0.length, 17)
  assert(t0.every((doc) => !('source' in doc) && !('pageBreaks' in doc) && !('fault' in doc)))
  const ids = new Set(t0.map((doc) => doc.id))
  assert(strata.every((doc) => !ids.has(doc.id)))
})

Deno.test('every printed label value appears in the rows as printed', () => {
  for (const doc of strata) {
    if (doc.kind === 'other') continue
    const cells = new Set(doc.rows.flat())
    const check = (value: unknown, key: string) => {
      if (typeof value !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(value)) return
      if (key === 'component' || key === 'description') return
      assert(cells.has(value), `${doc.id}: ${key} ${value}`)
    }
    const walk = (value: unknown, key = '') => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, key))
      else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([k, v]) => walk(v, k))
      } else check(value, key)
    }
    walk(doc.label)
  }
})

Deno.test('label dates are the printed dates in the document locale', () => {
  for (const doc of strata) {
    if (doc.kind === 'other') continue
    const format = FORMATS.find((f) => f.name === doc.locale)!
    const text = doc.rows.flat().join('\n')
    const dates = new Set<string>()
    JSON.stringify(doc.label).replace(/"(\d{4}-\d{2}-\d{2})"/g, (_, d) => (dates.add(d), ''))
    assert(dates.size > 0, doc.id)
    for (const date of dates) {
      assert(text.includes(format.date(new Date(date))), `${doc.id}: ${date}`)
    }
  }
})

Deno.test('every locale and every statement length is covered', () => {
  assertEquals(new Set(strata.map((doc) => doc.locale)).size, FORMATS.length)
  const sizes = new Set(
    ofKind('trade').map((doc) => doc.label.trades.length),
  )
  assertEquals([...sizes].sort((a, b) => a - b), [...new Set(TRADE_COUNTS)].sort((a, b) => a - b))
})

Deno.test('payslips span six or more layouts and one to four pages', () => {
  const docs = ofKind('payslip')
  assert(new Set(docs.map((doc) => doc.stratum)).size >= 6)
  const pages = new Set(docs.map((doc) => (doc.pageBreaks?.length ?? 0) + 1))
  assertEquals([...pages].sort(), [1, 2, 3, 4])
  const lines = docs.flatMap((doc) =>
    (doc.label as { earnings_lines: { period_amount: string | null }[] }).earnings_lines
  )
  assert(lines.some((line) => line.period_amount?.includes('-')), 'negative line')
})

Deno.test('pages stay within the renderer and hold content', () => {
  for (const doc of strata) {
    if (doc.rows.length === 0) continue
    const starts = [0, ...(doc.pageBreaks ?? []), doc.rows.length]
    for (let i = 1; i < starts.length; i++) {
      assert(starts[i] > starts[i - 1], doc.id)
      assert(starts[i] - starts[i - 1] <= 47, `${doc.id}: page ${i}`)
    }
  }
})

Deno.test('non-documents cover injections, faults and unreadable files', () => {
  const docs = ofKind('other')
  assertEquals(
    new Set(docs.map((doc) => doc.fault)),
    new Set([undefined, 'imageOnly', 'corrupt', 'encrypted']),
  )
  const kinds = new Set(docs.map((doc) => doc.stratum))
  for (
    const kind of [
      'letter',
      'bank-statement',
      'utility-bill',
      'menu',
      'blank-page',
      'prompt-injection',
    ]
  ) {
    assert(kinds.has(`other/${kind}`), kind)
  }
  assert(
    docs.some((doc) =>
      doc.rows.flat().some((cell) => /ignore all previous instructions/i.test(cell))
    ),
  )
  assert(docs.every((doc) => !('label' in doc)))
})
