import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import {
  aggregateClusters,
  binomialUpper,
  bootstrapDifference,
  coverageAtRisk,
  holm,
  reliability,
  riskCoverage,
} from './stats.ts'

const clusters = (values: [number, number][], prefix = 'c') =>
  values.map(([num, den], i) => ({ cluster: `${prefix}${i}`, num, den }))

Deno.test('the bootstrap is seeded, paired and covers a real difference', () => {
  const a = clusters(Array.from({ length: 40 }, (_, i) => [i % 5 === 0 ? 8 : 10, 10]))
  const b = clusters(Array.from({ length: 40 }, () => [7, 10]))
  const first = bootstrapDifference(a, b, { seed: 7 })!
  assertEquals(first, bootstrapDifference(a, b, { seed: 7 }))
  assertAlmostEquals(first.estimate, 0.26, 1e-9)
  assert(first.lo < first.estimate && first.estimate < first.hi)
  assert(first.lo > 0 && first.p < 0.01)
  assertEquals(first.clusters, 40)
})

Deno.test('identical arms differ by nothing and unshared clusters are ignored', () => {
  const a = clusters([[5, 10], [9, 10], [2, 10]])
  const same = bootstrapDifference(a, a, { resamples: 500 })!
  assertEquals([same.estimate, same.lo, same.hi, same.p], [0, 0, 0, 1])
  assertEquals(bootstrapDifference(a, clusters([[1, 1]], 'x')), null)
  assertEquals(bootstrapDifference(a, a.slice(0, 2), { resamples: 100 })!.clusters, 2)
})

Deno.test('ten thousand resamples stay fast', () => {
  const a = clusters(Array.from({ length: 200 }, (_, i) => [i % 3, 3]))
  const start = performance.now()
  bootstrapDifference(a, a)
  assert(performance.now() - start < 2000)
})

Deno.test('clusters are summed and Holm adjusts step down', () => {
  assertEquals(
    aggregateClusters([{ cluster: 'a', num: 1, den: 2 }, { cluster: 'a', num: 2, den: 2 }]),
    [{ cluster: 'a', num: 3, den: 4 }],
  )
  const adjusted = holm([0.04, 0.01, 0.03])
  assertAlmostEquals(adjusted[1], 0.03, 1e-12)
  assertAlmostEquals(adjusted[2], 0.06, 1e-12)
  assertAlmostEquals(adjusted[0], 0.06, 1e-12)
  assertEquals(holm([0.9, 0.9]), [1, 1])
})

Deno.test('the upper bound with no events matches the rule of three', () => {
  assertAlmostEquals(binomialUpper(0, 150), 0.0197, 0.0005)
  assertAlmostEquals(binomialUpper(0, 1000), 0.003, 0.0001)
  assertAlmostEquals(binomialUpper(2, 100), 0.0623, 0.001)
  assertEquals(binomialUpper(0, 0), 1)
})

Deno.test('risk-coverage accepts the most confident documents first', () => {
  const items = [
    { confidence: 0.9, error: 0, weight: 10 },
    { confidence: 0.9, error: 0, weight: 10 },
    { confidence: 0.5, error: 5, weight: 10 },
    { confidence: 0.1, error: 10, weight: 10 },
  ]
  const curve = riskCoverage(items)
  assertEquals(curve.map((p) => [p.threshold, p.coverage, p.risk]), [
    [0.9, 0.5, 0],
    [0.5, 0.75, 5 / 30],
    [0.1, 1, 15 / 40],
  ])
  assertEquals(coverageAtRisk(curve, 0.01), 0.5)
  assertEquals(coverageAtRisk(riskCoverage([{ confidence: 1, error: 1, weight: 1 }])), 0)
})

Deno.test('reliability bins documents by confidence', () => {
  const bins = reliability([
    { confidence: 1, error: 0, weight: 4 },
    { confidence: 0.95, error: 1, weight: 4 },
    { confidence: 0.05, error: 4, weight: 4 },
  ])
  assertEquals(bins.map((b) => [b.lo, b.documents, b.accuracy]), [[0, 1, 0], [0.9, 2, 7 / 8]])
})
