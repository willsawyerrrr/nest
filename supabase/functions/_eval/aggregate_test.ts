import { assertEquals, assertStringIncludes } from '@std/assert'
import { aggregateReport } from './aggregate.ts'
import { buildCorpus, type CorpusDoc } from './corpus.ts'
import type { EngineResults } from './score.ts'

const base = buildCorpus()
const template = base.find((doc) => doc.kind === 'deduction')!
const other = base.find((doc) => doc.kind === 'other')!

const synthetic = (
  count: number,
  stratum: string,
  prefix: string,
  from: CorpusDoc = template,
): CorpusDoc[] =>
  Array.from(
    { length: count },
    (_, i) => ({ ...from, id: `${prefix}${i}`, stratum, source: `${prefix}${i}` }),
  )

const engineFor = (docs: CorpusDoc[]): EngineResults => ({
  engine: 'arm',
  results: Object.fromEntries(
    docs.flatMap((doc) =>
      doc.kind === 'deduction'
        ? [[`${doc.id}:deduction`, { raw: (doc as { label: unknown }).label, ms: 1 }]]
        : [[`${doc.id}:deduction`, {
          raw: {
            is_receipt: false,
            not_receipt_reason: 'no',
            description: null,
            deduction_date: null,
            amount: null,
          },
          ms: 1,
        }]]
    ),
  ),
})

Deno.test('strata at the threshold are reported by stratum with no document named', () => {
  const docs = [...synthetic(6, 'receipt/thermal', 'r-aa'), ...synthetic(5, 'receipt/a4', 'r-bb')]
  const out = aggregateReport(docs, [engineFor(docs)])
  assertStringIncludes(out, '| receipt/thermal | 6 | 100% |')
  assertStringIncludes(out, '| all | 11 |')
  assertEquals(/r-aa|r-bb/.test(out), false)
})

Deno.test('a small stratum is withheld, and so is the total', () => {
  const docs = [...synthetic(6, 'receipt/thermal', 'r-aa'), ...synthetic(2, 'receipt/rare', 'r-bb')]
  const out = aggregateReport(docs, [engineFor(docs)])
  assertStringIncludes(out, '| receipt/rare | withheld (under 5) |')
  assertStringIncludes(out, '| all | withheld while any stratum is |')
  assertEquals(out.includes('| all | 8 |'), false)
})

Deno.test('non-document strata report how many were declined', () => {
  const docs = synthetic(5, 'other/letter', 'r-cc', other)
  const out = aggregateReport(docs, [engineFor(docs)])
  assertStringIncludes(out, '| other/letter | 5 | - | declined')
})
