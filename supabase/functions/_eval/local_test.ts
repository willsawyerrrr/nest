import { assertEquals, assertThrows } from '@std/assert'
import {
  type Config,
  diffPaths,
  documentId,
  finalLabel,
  inputFor,
  type LabelRecord,
  localDocs,
  parseLocal,
  SAMPLE_SHARE,
  status,
  validateRecord,
  verificationSample,
  verifierOf,
} from './local.ts'

const config: Config = { members: ['alex', 'sam'], labeller: 'alex' }

const record = (id: string, over: Partial<LabelRecord> = {}): LabelRecord => ({
  id,
  owner: 'sam',
  kind: 'deduction',
  stratum: 'receipt/thermal',
  financialYear: 2026,
  arms: ['on-device'],
  thirdParties: false,
  labelledBy: 'alex',
  label: { amount: '$1.00' },
  ...over,
})

Deno.test('the verifier is the member who does not label', () => {
  assertEquals(verifierOf(config), 'sam')
})

Deno.test('ids come from content and carry no name', async () => {
  const id = await documentId(new TextEncoder().encode('synthetic'))
  assertEquals(/^r-[0-9a-f]{12}$/.test(id), true)
  assertEquals(id, await documentId(new TextEncoder().encode('synthetic')))
})

Deno.test('records are held to the labeller, a stratum and a label', () => {
  validateRecord(record('r-1'), config)
  assertThrows(() => validateRecord(record('r-1', { labelledBy: 'sam' }), config))
  assertThrows(() => validateRecord(record('r-1', { stratum: 'Receipt' }), config))
  assertThrows(() => validateRecord(record('r-1', { label: undefined }), config))
  validateRecord(record('r-1', { kind: 'other', label: undefined }), config)
})

Deno.test('off-machine arms and third-party documents read only the redacted copy', () => {
  const all = record('r-1', { arms: ['on-device', 'pcc', 'claude'] })
  assertEquals(inputFor(all, 'on-device', false), 'original')
  assertEquals(inputFor(all, 'claude', false), null)
  assertEquals(inputFor(all, 'claude', true), 'redacted')
  const third = record('r-2', { arms: ['on-device'], thirdParties: true })
  assertEquals(inputFor(third, 'on-device', false), null)
  assertEquals(inputFor(third, 'on-device', true), 'redacted')
  assertEquals(inputFor(record('r-3'), 'pcc', true), null)
})

Deno.test('the sample is a fifth of each stratum, at least one, and stable', () => {
  const records = [
    ...Array.from({ length: 10 }, (_, i) => record(`r-a${i}`)),
    record('r-b0', { stratum: 'payslip/tabular' }),
  ]
  const sample = verificationSample(records)
  assertEquals(sample.length, Math.ceil(SAMPLE_SHARE * 10) + 1)
  assertEquals(sample.includes('r-b0'), true)
  assertEquals(verificationSample([...records].reverse()), sample)
})

Deno.test('diffs name paths, never values', () => {
  assertEquals(diffPaths({ a: '1', b: ['x', 'y'] }, { a: '2', b: ['x', 'z'] }), ['/a', '/b/1'])
  assertEquals(diffPaths({ a: 1 }, { a: 1 }), [])
})

Deno.test('a resolved label wins and status counts agreement and disputes', () => {
  const records = [record('r-1'), record('r-2', { label: { amount: '$2.00' } })]
  const verifications = [
    { id: 'r-1', verifiedBy: 'sam', label: { amount: '$1.00' } },
    { id: 'r-2', verifiedBy: 'sam', label: { amount: '$2.50' } },
  ]
  assertEquals(finalLabel(records[1], verifications[1]), { amount: '$2.00' })
  assertEquals(finalLabel(records[1], { ...verifications[1], resolved: { amount: '$2.50' } }), {
    amount: '$2.50',
  })
  const s = status(records, verifications)
  assertEquals([s.agreed, s.unresolved], [1, 1])
  const docs = localDocs(records, [{ ...verifications[1], resolved: { amount: '$2.50' } }])
  assertEquals(docs[1] as unknown, {
    id: 'r-2',
    kind: 'deduction',
    financialYear: 2026,
    rows: [],
    stratum: 'receipt/thermal',
    source: 'r-2',
    label: { amount: '$2.50' },
  })
})

Deno.test('parseLocal validates and sorts', () => {
  const parsed = parseLocal({ config, records: [record('r-2'), record('r-1')], verifications: [] })
  assertEquals(parsed.records.map((r) => r.id), ['r-1', 'r-2'])
  assertThrows(() =>
    parseLocal({
      config: { members: ['alex', 'alex'], labeller: 'alex' },
      records: [],
      verifications: [],
    })
  )
  assertThrows(() =>
    parseLocal({ config, records: [record('r-1', { owner: 'someone' })], verifications: [] })
  )
})
