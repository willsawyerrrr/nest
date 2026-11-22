/**
 * Scores engines' results against the corpus and prints a Markdown table.
 *
 * `deno run --allow-read report.ts <dir>` reads `<dir>/corpus.json` and every
 * `<dir>/results/*.json`.
 */

import type { CorpusDoc, DocKind } from './corpus.ts'
import { type EngineResults, resultKey, type Score, scoreRun } from './score.ts'

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

if (import.meta.main) {
  const dir = Deno.args[0]
  if (!dir) throw new Error('usage: report.ts <dir>')
  const corpus: CorpusDoc[] = JSON.parse(await Deno.readTextFile(`${dir}/corpus.json`))
  const engines: EngineResults[] = []
  for await (const entry of Deno.readDir(`${dir}/results`)) {
    if (entry.name.endsWith('.json')) {
      engines.push(JSON.parse(await Deno.readTextFile(`${dir}/results/${entry.name}`)))
    }
  }
  engines.sort((a, b) => a.engine.localeCompare(b.engine))
  console.log(report(corpus, engines))
}
