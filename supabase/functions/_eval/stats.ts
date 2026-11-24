/**
 * Statistics for comparing extraction arms: a seeded paired clustered bootstrap,
 * Holm correction, an exact binomial upper bound, and risk-coverage and
 * reliability tables for confidence proxies.
 */

/** A small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One source document's contribution to a ratio metric. */
export interface ClusterTotal {
  cluster: string
  num: number
  den: number
}

/** Sums contributions that share a cluster. */
export function aggregateClusters(items: ClusterTotal[]): ClusterTotal[] {
  const byCluster = new Map<string, ClusterTotal>()
  for (const { cluster, num, den } of items) {
    const total = byCluster.get(cluster) ?? { cluster, num: 0, den: 0 }
    total.num += num
    total.den += den
    byCluster.set(cluster, total)
  }
  return [...byCluster.values()]
}

export interface Interval {
  /** The difference `a - b` over every shared cluster. */
  estimate: number
  /** Lower and upper bounds of the 95% percentile interval. */
  lo: number
  hi: number
  /** Two-sided bootstrap p-value for a difference of zero. */
  p: number
  clusters: number
}

export const RESAMPLES = 10_000

const ratio = (num: number, den: number): number => den === 0 ? 0 : num / den

/**
 * Paired clustered bootstrap of the difference between two ratio metrics. Source
 * documents are resampled with replacement and both arms are re-scored on the
 * same resample; only clusters both arms answered take part. Returns `null`
 * when the arms share none.
 */
export function bootstrapDifference(
  a: ClusterTotal[],
  b: ClusterTotal[],
  { resamples = RESAMPLES, seed = 1 }: { resamples?: number; seed?: number } = {},
): Interval | null {
  const bByCluster = new Map(b.map((total) => [total.cluster, total]))
  const shared = a
    .filter((total) => bByCluster.has(total.cluster))
    .sort((x, y) => x.cluster.localeCompare(y.cluster))
  const n = shared.length
  if (n === 0) return null
  const aNum = Float64Array.from(shared, (t) => t.num)
  const aDen = Float64Array.from(shared, (t) => t.den)
  const bNum = Float64Array.from(shared, (t) => bByCluster.get(t.cluster)!.num)
  const bDen = Float64Array.from(shared, (t) => bByCluster.get(t.cluster)!.den)
  const sum = (values: Float64Array) => values.reduce((acc, v) => acc + v, 0)
  const estimate = ratio(sum(aNum), sum(aDen)) - ratio(sum(bNum), sum(bDen))

  const next = rng(seed)
  const diffs = new Float64Array(resamples)
  let atMostZero = 0
  let atLeastZero = 0
  for (let r = 0; r < resamples; r++) {
    let an = 0, ad = 0, bn = 0, bd = 0
    for (let i = 0; i < n; i++) {
      const k = Math.floor(next() * n)
      an += aNum[k]
      ad += aDen[k]
      bn += bNum[k]
      bd += bDen[k]
    }
    const diff = ratio(an, ad) - ratio(bn, bd)
    diffs[r] = diff
    if (diff <= 0) atMostZero++
    if (diff >= 0) atLeastZero++
  }
  diffs.sort()
  const at = (q: number) => diffs[Math.min(resamples - 1, Math.floor(q * resamples))]
  const p = Math.min(
    1,
    2 * Math.min((atMostZero + 1) / (resamples + 1), (atLeastZero + 1) / (resamples + 1)),
  )
  return { estimate, lo: at(0.025), hi: at(0.975), p, clusters: n }
}

/** Holm step-down adjusted p-values, in the order given. */
export function holm(pValues: number[]): number[] {
  const m = pValues.length
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p)
  const adjusted = new Array<number>(m)
  let running = 0
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p))
    adjusted[i] = running
  })
  return adjusted
}

/**
 * The exact one-sided upper confidence bound on a rate with `events` in `n`
 * trials (Clopper-Pearson). With no events it is close to the rule of three.
 */
export function binomialUpper(events: number, n: number, confidence = 0.95): number {
  if (n === 0) return 1
  if (events >= n) return 1
  const logChoose = [0]
  for (let i = 1; i <= events; i++) logChoose[i] = logChoose[i - 1] + Math.log((n - i + 1) / i)
  const cdf = (p: number) => {
    let total = 0
    for (let i = 0; i <= events; i++) {
      total += Math.exp(logChoose[i] + i * Math.log(p) + (n - i) * Math.log1p(-p))
    }
    return total
  }
  let [lo, hi] = [0, 1]
  for (let step = 0; step < 60; step++) {
    const mid = (lo + hi) / 2
    if (cdf(mid) > 1 - confidence) lo = mid
    else hi = mid
  }
  return hi
}

/** One document, ranked by a confidence proxy, with the impact weight it carries and lost. */
export interface RiskItem {
  confidence: number
  /** Impact weight of the fields that were not correct. */
  error: number
  /** Impact weight of every field. */
  weight: number
}

export interface RiskPoint {
  /** Documents at or above this confidence are accepted without review. */
  threshold: number
  /** Share of documents accepted. */
  coverage: number
  /** Impact-weighted field error among the accepted documents. */
  risk: number
}

/** The risk-coverage curve: one point per distinct confidence, most confident first. */
export function riskCoverage(items: RiskItem[]): RiskPoint[] {
  const sorted = items.filter((item) => item.weight > 0).sort((x, y) => y.confidence - x.confidence)
  const points: RiskPoint[] = []
  let error = 0
  let weight = 0
  sorted.forEach((item, i) => {
    error += item.error
    weight += item.weight
    if (i + 1 === sorted.length || sorted[i + 1].confidence !== item.confidence) {
      points.push({
        threshold: item.confidence,
        coverage: (i + 1) / sorted.length,
        risk: error / weight,
      })
    }
  })
  return points
}

/** The largest share of documents the curve accepts at no more than `maxRisk` error. */
export function coverageAtRisk(points: RiskPoint[], maxRisk = 0.01): number {
  return points.reduce(
    (best, point) => point.risk <= maxRisk ? Math.max(best, point.coverage) : best,
    0,
  )
}

export interface ReliabilityBin {
  lo: number
  hi: number
  documents: number
  meanConfidence: number
  /** Impact-weighted share of fields correct. */
  accuracy: number
}

/** Documents grouped into equal-width confidence bins, empty bins left out. */
export function reliability(items: RiskItem[], bins = 10): ReliabilityBin[] {
  const groups: RiskItem[][] = Array.from({ length: bins }, () => [])
  for (const item of items) {
    if (item.weight > 0) groups[Math.min(bins - 1, Math.floor(item.confidence * bins))].push(item)
  }
  return groups.flatMap((group, i) => {
    if (group.length === 0) return []
    const error = group.reduce((acc, item) => acc + item.error, 0)
    const weight = group.reduce((acc, item) => acc + item.weight, 0)
    return [{
      lo: i / bins,
      hi: (i + 1) / bins,
      documents: group.length,
      meanConfidence: group.reduce((acc, item) => acc + item.confidence, 0) / group.length,
      accuracy: 1 - error / weight,
    }]
  })
}
