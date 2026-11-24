/**
 * Scores engines' results against the corpus and prints Markdown tables: the
 * exact-match summary, error classes and calibration per engine, and the
 * decision matrix per document type.
 *
 * `deno run --allow-read report.ts <dir> [--baseline <engine>]` reads
 * `<dir>/corpus.json`, `strata.json` and the noisy variants of `manifest.json` when
 * present (a variant is scored against its source document's label), every `<dir>/results/*.json` and, when present,
 * `<dir>/profiles.json` (engine name to `ArmProfile`).
 */

import type { CorpusDoc, DocKind } from './corpus.ts'
import { loadDocs } from './noise.ts'
import {
  agreementConfidence,
  declineStats,
  type EngineResults,
  outcomeOf,
  readEngine,
  resultKey,
  riskItem,
  type RunOutcome,
  type Score,
  scoreRun,
  stability,
  summarise,
  type Summary,
  validatorConfidence,
} from './score.ts'
import {
  aggregateClusters,
  binomialUpper,
  bootstrapDifference,
  type ClusterTotal,
  coverageAtRisk,
  holm,
  type Interval,
  riskCoverage,
} from './stats.ts'

const EXTRACTORS: Exclude<DocKind, 'other'>[] = ['payslip', 'deduction', 'trade']

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

/** One row per engine and extractor: accuracy, spurious extras, failures, latency, tokens. */
export function report(corpus: CorpusDoc[], engines: EngineResults[]): string {
  const lines = [
    '| Engine | Extractor | Correct | Correct, printed dates accepted | Spurious | Failed | Median ms | Max prompt tokens |',
    '| -- | -- | -- | -- | -- | -- | -- | -- |',
  ]
  for (const engine of engines) {
    for (const extractor of EXTRACTORS) {
      const total: Score = { units: 0, correct: 0, spurious: 0 }
      let lenient = 0
      let failed = 0
      let runs = 0
      const times: number[] = []
      const tokens: number[] = []
      for (const doc of corpus) {
        const run = engine.results[resultKey(doc.id, extractor)]
        if (!run) continue
        runs++
        const score = scoreRun(doc, extractor, run)
        total.units += score.units
        total.correct += score.correct
        total.spurious += score.spurious
        lenient += scoreRun(doc, extractor, run, { printedDates: true }).correct
        if (run.raw === undefined) failed++
        times.push(run.ms)
        if (run.promptTokens !== undefined) tokens.push(run.promptTokens)
      }
      if (runs === 0) continue
      const pct = (correct: number) =>
        total.units === 0 ? 0 : Math.round((100 * correct) / total.units)
      lines.push(
        `| ${engine.engine} | ${extractor} | ${total.correct}/${total.units} (${
          pct(total.correct)
        }%) | ${lenient}/${total.units} (${
          pct(lenient)
        }%) | ${total.spurious} | ${failed}/${runs} | ${percentile(times, 0.5)} | ${
          tokens.length ? Math.max(...tokens) : '-'
        } |`,
      )
    }
  }
  return lines.join('\n')
}

type Extractor = Exclude<DocKind, 'other'>

/** The slice of the corpus a document falls in: clean, a noise profile, or a two-up page. */
const SLICES: Array<[string, (doc: CorpusDoc) => boolean]> = [
  ['clean', (doc) => doc.profile === undefined],
  ['born-digital', (doc) => doc.profile === 'born-digital'],
  ['scan', (doc) => doc.profile === 'scan'],
  ['photo', (doc) => doc.profile === 'photo'],
  ['screen', (doc) => doc.profile === 'screen'],
  ['two-up', (doc) => doc.companion !== undefined],
]

/**
 * Exact-match accuracy per engine, extractor and slice, so what noise costs
 * shows against the clean documents. A two-up variant also counts under its
 * profile; it is scored against the label of the document on top, so reading
 * its companion instead counts as wrong. Empty when the corpus has no variants.
 */
export function variantReport(corpus: CorpusDoc[], engines: EngineResults[]): string {
  if (!corpus.some((doc) => doc.profile !== undefined)) return ''
  const lines = [
    '| Engine | Extractor | Slice | Correct | Documents |',
    '| -- | -- | -- | -- | -- |',
  ]
  for (const engine of engines) {
    for (const extractor of EXTRACTORS) {
      for (const [name, inSlice] of SLICES) {
        const total: Score = { units: 0, correct: 0, spurious: 0 }
        let runs = 0
        for (const doc of corpus.filter(inSlice)) {
          const run = engine.results[resultKey(doc.id, extractor)]
          if (!run) continue
          const score = scoreRun(doc, extractor, run)
          total.units += score.units
          total.correct += score.correct
          runs++
        }
        if (runs === 0) continue
        const pct = total.units === 0 ? 0 : Math.round((100 * total.correct) / total.units)
        lines.push(
          `| ${engine.engine} | ${extractor} | ${name} | ${total.correct}/${total.units} (${pct}%) | ${runs} |`,
        )
      }
    }
  }
  return lines.join('\n')
}

/**
 * Median latency of cold runs (the process's first generation, paying model
 * load and warm-up) against warm ones, per engine and extractor. Engines that
 * do not label their runs are left out.
 */
export function timingReport(corpus: CorpusDoc[], engines: EngineResults[]): string {
  const lines = [
    '| Engine | Extractor | Cold runs | Cold median ms | Warm runs | Warm median ms |',
    '| -- | -- | -- | -- | -- | -- |',
  ]
  for (const engine of engines) {
    for (const extractor of EXTRACTORS) {
      const runs = corpus.flatMap((doc) => runsOf(engine, resultKey(doc.id, extractor)))
      const [cold, warm] = (['cold', 'warm'] as const).map((timing) =>
        runs.filter((run) => run.timing === timing).map((run) => run.ms)
      )
      if (cold.length + warm.length === 0) continue
      const median = (times: number[]) => times.length ? percentile(times, 0.5) : '-'
      lines.push(
        `| ${engine.engine} | ${extractor} | ${cold.length} | ${median(cold)} | ${warm.length} | ${
          median(warm)
        } |`,
      )
    }
  }
  return lines.join('\n')
}

/** What the decision matrix needs to know about an arm that its results do not say. */
export interface ArmProfile {
  /** `local` arms (on-device, PCC) face the stricter gates; `claude` arms must beat the baseline. */
  tier: 'local' | 'claude'
  /** On-device 3, PCC 2, server Claude 1. */
  privacy: 1 | 2 | 3
  offline: boolean
  /** Dollars per 1000 documents by extractor; on-device is 0. */
  costPer1000?: Partial<Record<Extractor, number>>
  /** Share of the household's devices and OS versions where the arm is available. */
  coverage?: number
}

export interface DecisionOptions {
  /** The engine every other is compared with. */
  baseline?: string
  profiles?: Record<string, ArmProfile>
  /** Accept printed `DD/MM/YYYY` dates, as a native path that converts them would. */
  printedDates?: boolean
  resamples?: number
  seed?: number
}

/** Weights of the scored criteria, frozen before the first run. */
const CRITERIA: Record<Extractor, Record<string, number>> = {
  deduction: {
    accuracy: 40,
    stability: 10,
    privacy: 15,
    cost: 10,
    latency: 15,
    offline: 5,
    coverage: 5,
  },
  payslip: {
    accuracy: 40,
    stability: 10,
    privacy: 15,
    cost: 10,
    latency: 10,
    offline: 10,
    coverage: 5,
  },
  trade: {
    accuracy: 40,
    stability: 10,
    privacy: 15,
    cost: 10,
    latency: 10,
    offline: 10,
    coverage: 5,
  },
}
const TYPE_NAMES: Record<Extractor, string> = {
  deduction: 'Receipt',
  payslip: 'Payslip',
  trade: 'Trade',
}
const NON_INFERIORITY = 0.03
const MAX_WRONG_CONFIDENT = 0.02
const MIN_LOCAL_ACCURACY = 0.9
const MIN_DECLINED = 0.95
const MAX_FALSE_DECLINE = 0.02
const MAX_CANNOT_ANSWER = 0.1
const MIN_STABILITY = 0.98

export type GateStatus = 'pass' | 'fail' | 'unmeasured'

export interface Gate {
  name: string
  status: GateStatus
}

export interface ArmRow {
  engine: string
  profile?: ArmProfile
  summary: Summary
  /** Difference from the baseline in accuracy; null for the baseline itself or without one. */
  interval: Interval | null
  /** Holm-adjusted p-value across the three types; null without an interval. */
  adjustedP: number | null
  wrongConfidentUpper: number
  decline: ReturnType<typeof declineStats>
  cannotAnswer: number
  p95Ms: number | null
  stability: number | null
  gates: Gate[]
  /** Weighted score; null unless every gate passes and a profile gives the rest. */
  score: number | null
}

/** Every repeat of an engine's run on a document, or its single run. */
const runsOf = (engine: EngineResults, key: string) =>
  engine.repeats?.[key] ?? (engine.results[key] ? [engine.results[key]] : [])

/** An engine's outcomes for one extractor, one per repeat of each document it ran. */
export function outcomesFor(
  corpus: CorpusDoc[],
  engine: EngineResults,
  extractor: DocKind,
  options: { printedDates?: boolean } = {},
): RunOutcome[] {
  return corpus.flatMap((doc) =>
    runsOf(engine, resultKey(doc.id, extractor)).map((run) =>
      outcomeOf(doc, extractor, run, options)
    )
  )
}

/** Each source document's share of impact weight kept, for the bootstrap. */
function clusterTotals(outcomes: RunOutcome[]): ClusterTotal[] {
  return aggregateClusters(
    outcomes.filter((run) => run.fields.length > 0).map((run) => ({
      cluster: run.source,
      num: run.fields.reduce((acc, unit) => acc + (unit.cls === 'correct' ? unit.weight : 0), 0),
      den: run.fields.reduce((acc, unit) => acc + unit.weight, 0),
    })),
  )
}

/** Mean stability over documents that have repeats; null when none do. */
function meanStability(outcomes: RunOutcome[]): number | null {
  const byDoc = Map.groupBy(
    outcomes.filter((run) => run.kind === run.extractor),
    (run) => run.docId,
  )
  const values = [...byDoc.values()].map(stability).filter((v): v is number => v !== null)
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function gatesFor(extractor: Extractor, row: Omit<ArmRow, 'gates' | 'score'>, baseline?: ArmRow) {
  const local = row.profile?.tier === 'local'
  const status = (ok: boolean): GateStatus => ok ? 'pass' : 'fail'
  const { summary, decline } = row
  const gates: Gate[] = []
  gates.push({
    name: 'accuracy',
    status: row.engine === baseline?.engine
      ? 'pass'
      : row.interval === null
      ? 'unmeasured'
      : local
      ? status(row.interval.lo >= -NON_INFERIORITY && summary.accuracy >= MIN_LOCAL_ACCURACY)
      : status(row.interval.hi > NON_INFERIORITY),
  })
  gates.push({
    name: 'wrong-confident',
    status: summary.filled === 0 ? 'unmeasured' : status(
      row.wrongConfidentUpper <= MAX_WRONG_CONFIDENT &&
        (baseline === undefined || baseline.summary.filled === 0 ||
          summary.wrongConfident / summary.filled <=
            baseline.summary.wrongConfident / baseline.summary.filled),
    ),
  })
  gates.push({
    name: 'severe',
    status: summary.weight === 0 ? 'unmeasured' : status(summary.severe === 0),
  })
  gates.push({
    name: 'decline',
    status: decline.negatives === 0 || decline.positives === 0 ? 'unmeasured' : status(
      decline.declinedNegatives / decline.negatives >= MIN_DECLINED &&
        decline.declinedPositives / decline.positives <= MAX_FALSE_DECLINE,
    ),
  })
  if (local) {
    gates.push({
      name: 'cannot-answer',
      status: summary.runs === 0 ? 'unmeasured' : status(row.cannotAnswer <= MAX_CANNOT_ANSWER),
    })
  }
  gates.push({
    name: 'stability',
    status: row.stability === null ? 'unmeasured' : status(row.stability >= MIN_STABILITY),
  })
  const limit = local && extractor === 'deduction' ? 15_000 : 30_000
  gates.push({
    name: 'latency',
    status: row.p95Ms === null ? 'unmeasured' : status(row.p95Ms <= limit),
  })
  return gates
}

/** The weighted score of an arm that passes every gate, from 0 to 100. */
function scoreFor(extractor: Extractor, row: ArmRow, baseline?: ArmRow): number | null {
  const { profile } = row
  if (!profile || row.stability === null || row.p95Ms === null) return null
  const cost = profile.costPer1000?.[extractor]
  const baseCost = baseline?.profile?.costPer1000?.[extractor]
  if (cost === undefined || baseCost === undefined || profile.coverage === undefined) return null
  const weights = CRITERIA[extractor]
  const limit = profile.tier === 'local' && extractor === 'deduction' ? 15_000 : 30_000
  const parts: Record<string, number> = {
    accuracy: row.summary.accuracy,
    stability: row.stability,
    privacy: profile.privacy / 3,
    // 0.5 at the baseline's cost, 1 at a tenth of it or free, 0 at ten times it.
    cost: cost === 0 ? 1 : clamp01(0.5 - Math.log10(cost / baseCost) / 2),
    latency: clamp01(1 - row.p95Ms / limit),
    offline: profile.offline ? 1 : 0,
    coverage: clamp01(profile.coverage),
  }
  return Object.entries(weights).reduce((acc, [name, weight]) => acc + weight * parts[name], 0)
}

/** Evaluates every engine on every extractor, with Holm correction across the extractors. */
export function evaluate(
  corpus: CorpusDoc[],
  engines: EngineResults[],
  options: DecisionOptions = {},
): Record<Extractor, ArmRow[]> {
  const { baseline, profiles = {}, printedDates, resamples, seed } = options
  const rows = {} as Record<Extractor, ArmRow[]>
  for (const extractor of EXTRACTORS) {
    const outcomes = new Map(
      engines.map((
        engine,
      ) => [engine.engine, outcomesFor(corpus, engine, extractor, { printedDates })]),
    )
    const base = baseline === undefined ? undefined : outcomes.get(baseline)
    const baseTotals = base && clusterTotals(base)
    rows[extractor] = engines.flatMap((engine): ArmRow[] => {
      const runs = outcomes.get(engine.engine)!
      if (runs.length === 0) return []
      const summary = summarise(runs)
      const times = runs.map((run) => run.ms)
      const partial = {
        engine: engine.engine,
        profile: profiles[engine.engine] ?? inferProfile(engine.engine),
        summary,
        interval: baseTotals && engine.engine !== baseline
          ? bootstrapDifference(clusterTotals(runs), baseTotals, { resamples, seed })
          : null,
        adjustedP: null,
        wrongConfidentUpper: binomialUpper(summary.wrongConfident, summary.filled),
        decline: declineStats(runs),
        cannotAnswer: summary.failed / runs.length,
        p95Ms: percentile(times, 0.95),
        stability: meanStability(runs),
      }
      return [{ ...partial, gates: [], score: null }]
    })
  }
  // Holm across the three types, separately for each engine.
  for (const engine of engines) {
    const entries = EXTRACTORS.flatMap((extractor) => {
      const row = rows[extractor].find((r) => r.engine === engine.engine)
      return row?.interval ? [row] : []
    })
    const adjusted = holm(entries.map((row) => row.interval!.p))
    entries.forEach((row, i) => row.adjustedP = adjusted[i])
  }
  for (const extractor of EXTRACTORS) {
    const baselineRow = rows[extractor].find((row) => row.engine === baseline)
    for (const row of rows[extractor]) {
      row.gates = gatesFor(extractor, row, baselineRow)
      row.score = row.gates.every((gate) => gate.status === 'pass')
        ? scoreFor(extractor, row, baselineRow)
        : null
    }
  }
  return rows
}

/** Claude arms are named `haiku-…` or `claude-…`; anything else is taken to run locally. */
function inferProfile(engine: string): ArmProfile | undefined {
  return /^(haiku|claude|sonnet|opus|fable)/.test(engine)
    ? { tier: 'claude', privacy: 1, offline: false }
    : { tier: 'local', privacy: 3, offline: true }
}

const points = (x: number) => `${(100 * x).toFixed(1)}%`
const signed = (x: number) => `${x >= 0 ? '+' : '-'}${Math.abs(100 * x).toFixed(1)}`

function gateCell(gates: Gate[]): string {
  const open = gates.filter((gate) => gate.status !== 'pass')
  return open.length === 0
    ? 'all'
    : open.map((gate) => gate.status === 'fail' ? gate.name : `${gate.name}?`).join(', ')
}

/**
 * The decision matrix per document type: gates first, weighted scores only for
 * arms that pass every gate. A gate marked `?` could not be measured and does
 * not pass.
 */
export function decisionMatrix(
  corpus: CorpusDoc[],
  engines: EngineResults[],
  options: DecisionOptions = {},
): string {
  const rows = evaluate(corpus, engines, options)
  const out: string[] = []
  for (const extractor of EXTRACTORS) {
    if (rows[extractor].length === 0) continue
    out.push(
      `### ${TYPE_NAMES[extractor]}`,
      '',
      '| Arm | Accuracy (CI) | Wrong-confident (upper) | Decline | Cannot-answer | p95 latency | $/1000 | Offline | Coverage | Gates | Score |',
      '| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |',
    )
    for (const row of rows[extractor]) {
      const { summary, decline, interval, profile } = row
      const accuracy = interval
        ? `${points(summary.accuracy)} (${signed(interval.estimate)} [${signed(interval.lo)}, ${
          signed(interval.hi)
        }], p ${row.adjustedP?.toFixed(3)})`
        : points(summary.accuracy)
      const declined = decline.negatives === 0 || decline.positives === 0
        ? '-'
        : `${points(decline.declinedNegatives / decline.negatives)} / ${
          points(decline.declinedPositives / decline.positives)
        }`
      const cost = profile?.costPer1000?.[extractor]
      out.push(
        `| ${row.engine} | ${accuracy} | ${
          summary.filled === 0
            ? '-'
            : `${points(summary.wrongConfident / summary.filled)} (${
              points(row.wrongConfidentUpper)
            })`
        } | ${declined} | ${points(row.cannotAnswer)} | ${
          row.p95Ms === null ? '-' : `${row.p95Ms} ms`
        } | ${cost === undefined ? '-' : cost} | ${
          profile ? (profile.offline ? 'yes' : 'no') : '-'
        } | ${profile?.coverage === undefined ? '-' : points(profile.coverage)} | ${
          gateCell(row.gates)
        } | ${row.score === null ? '-' : row.score.toFixed(1)} |`,
      )
    }
    out.push('')
  }
  return out.join('\n')
}

/**
 * Per engine and extractor: error classes, wrong-confident and severe errors,
 * rounding and description diagnostics, stability, and the share of documents
 * each confidence proxy lets through without review at 1% weighted error.
 */
export function diagnostics(
  corpus: CorpusDoc[],
  engines: EngineResults[],
  options: { printedDates?: boolean } = {},
): string {
  const lines = [
    '| Engine | Extractor | Weighted accuracy | Correct | Missing | Wrong | Spurious | Format | Wrong-confident | Severe | Within 1c | Token F1 | Stability | Auto-accept at 1%: validators | repeats | arms | self-reported |',
    '| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |',
  ]
  for (const extractor of EXTRACTORS) {
    const all = engines.map((engine) => ({
      engine,
      runs: outcomesFor(corpus, engine, extractor, options),
    }))
    // The same document's first run under each arm, for agreement across arms.
    const firstByDoc = Map.groupBy(
      all.flatMap(({ runs }) =>
        [...Map.groupBy(runs, (run) => run.docId).values()].map((group) => group[0])
      ),
      (run) => run.docId,
    )
    for (const { engine, runs } of all) {
      if (runs.length === 0) continue
      const summary = summarise(runs)
      const positives = runs.filter((run) => run.kind === run.extractor)
      const coverage = (confidences: (number | undefined)[]) => {
        const items = positives.flatMap((run, i) =>
          confidences[i] === undefined ? [] : [riskItem(run, confidences[i]!)]
        )
        return items.length === 0 ? '-' : points(coverageAtRisk(riskCoverage(items)))
      }
      const repeatConfidence = new Map<RunOutcome, number>()
      for (const group of Map.groupBy(positives, (run) => run.docId).values()) {
        agreementConfidence(group).forEach((c, i) => repeatConfidence.set(group[i], c))
      }
      const armConfidence = new Map<RunOutcome, number>()
      for (const group of firstByDoc.values()) {
        agreementConfidence(group).forEach((c, i) => armConfidence.set(group[i], c))
      }
      const count = (n: number) => String(n)
      lines.push(
        `| ${engine.engine} | ${extractor} | ${points(summary.accuracy)} | ${
          count(summary.classes.correct)
        } | ${count(summary.classes.missing)} | ${count(summary.classes.wrong)} | ${
          count(summary.classes.spurious)
        } | ${
          count(summary.classes.format)
        } | ${summary.wrongConfident}/${summary.filled} | ${summary.severe} | ${summary.withinCent} | ${
          summary.meanF1 === null ? '-' : summary.meanF1.toFixed(2)
        } | ${meanStability(runs) === null ? '-' : points(meanStability(runs)!)} | ${
          coverage(positives.map(validatorConfidence))
        } | ${coverage(positives.map((run) => repeatConfidence.get(run)))} | ${
          coverage(positives.map((run) => armConfidence.get(run)))
        } | ${coverage(positives.map((run) => run.confidence))} |`,
      )
    }
  }
  return lines.join('\n')
}

if (import.meta.main) {
  const [dir, ...rest] = Deno.args
  if (!dir) throw new Error('usage: report.ts <dir> [--baseline <engine>]')
  const baselineAt = rest.indexOf('--baseline')
  const baseline = baselineAt >= 0 ? rest[baselineAt + 1] : undefined
  const { docs: corpus } = await loadDocs(dir)
  const engines: EngineResults[] = []
  for await (const entry of Deno.readDir(`${dir}/results`)) {
    if (entry.name.endsWith('.json')) {
      engines.push(
        readEngine(JSON.parse(await Deno.readTextFile(`${dir}/results/${entry.name}`))),
      )
    }
  }
  engines.sort((a, b) => a.engine.localeCompare(b.engine))
  const profiles: Record<string, ArmProfile> = await Deno.readTextFile(`${dir}/profiles.json`)
    .then(JSON.parse, () => ({}))
  console.log(report(corpus, engines))
  const variants = variantReport(corpus, engines)
  if (variants) console.log(`\n## Noise and two-up pages\n\n${variants}`)
  console.log('\n## Error classes and calibration\n')
  console.log(diagnostics(corpus, engines))
  console.log('\n## Cold and warm latency\n')
  console.log(timingReport(corpus, engines))
  console.log('\n## Decision matrix\n')
  console.log(decisionMatrix(corpus, engines, { baseline, profiles }))
}
