/**
 * Aggregate-only reporting for the real-document corpus (tier T3).
 *
 * Results are published by stratum and never per document: no row, error or log
 * line names a document, its id or its values. A stratum with fewer than
 * `MIN_DOCUMENTS` documents is withheld, since a small group's rate says too
 * much about each member of it, and the all-strata total is withheld whenever
 * any stratum is, so a withheld stratum cannot be recovered by subtraction.
 *
 * `deno run --allow-read aggregate.ts <evals/local dir> [results dir...]` reads the labelled
 * documents and the results of each results directory (default `<dir>/results`, where
 * `ExtractionEval run` writes for a corpus directory laid out by `local.ts materialize`) and prints
 * Markdown.
 */

import type { CorpusDoc, DocKind } from './corpus.ts'
import { loadLocal, localDocs, LocalError } from './local.ts'
import { outcomesFor } from './report.ts'
import { declineStats, type EngineResults, readEngine, summarise } from './score.ts'

export const MIN_DOCUMENTS = 5

const EXTRACTORS: Exclude<DocKind, 'other'>[] = ['payslip', 'deduction', 'trade']

const percent = (part: number, whole: number): string =>
  whole === 0 ? '-' : `${Math.round((100 * part) / whole)}%`

interface Line {
  stratum: string
  documents: number
  cells: string[]
}

/** One engine's figures over a set of documents of one kind. */
function figures(docs: CorpusDoc[], engine: EngineResults): string[] {
  const kind = docs[0].kind
  if (kind === 'other') {
    let [negatives, declined, failed, limited] = [0, 0, 0, 0]
    for (const extractor of EXTRACTORS) {
      const outcomes = outcomesFor(docs, engine, extractor)
      const stats = declineStats(outcomes)
      negatives += stats.negatives
      declined += stats.declinedNegatives
      const summary = summarise(outcomes)
      failed += summary.failed
      limited += summary.rateLimited
    }
    return ['-', `declined ${percent(declined, negatives)}`, '-', `${failed}, ${limited}`]
  }
  const summary = summarise(outcomesFor(docs, engine, kind))
  return [
    percent(summary.correctWeight, summary.weight),
    '-',
    `${summary.wrongConfident}/${summary.filled}`,
    `${summary.failed}, ${summary.rateLimited}`,
  ]
}

/**
 * One table per engine: a row per stratum with its document count, impact-weighted accuracy,
 * decline rate (non-documents), wrong-but-confident over filled fields, and failed and rate-limited runs.
 */
export function aggregateReport(
  docs: CorpusDoc[],
  engines: EngineResults[],
  minDocuments = MIN_DOCUMENTS,
): string {
  const strata = [...Map.groupBy(docs, (doc) => doc.stratum ?? 'unstratified')]
    .sort(([a], [b]) => a.localeCompare(b))
  const out: string[] = []
  for (const engine of engines) {
    const lines: Line[] = []
    let withheld = 0
    for (const [stratum, group] of strata) {
      const ran = group.filter((doc) =>
        EXTRACTORS.some((extractor) =>
          engine.results[`${doc.id}:${extractor}`] || engine.repeats?.[`${doc.id}:${extractor}`]
        )
      )
      if (ran.length === 0) continue
      if (ran.length < minDocuments) {
        withheld++
        lines.push({ stratum, documents: ran.length, cells: [] })
      } else lines.push({ stratum, documents: ran.length, cells: figures(ran, engine) })
    }
    out.push(
      `### ${engine.engine}\n`,
      '| Stratum | Documents | Accuracy | Non-documents | Wrong but confident | Failed, rate limited |',
      '| -- | -- | -- | -- | -- | -- |',
    )
    for (const line of lines) {
      out.push(
        line.cells.length === 0
          ? `| ${line.stratum} | withheld (under ${minDocuments}) | - | - | - | - |`
          : `| ${line.stratum} | ${line.documents} | ${line.cells.join(' | ')} |`,
      )
    }
    if (withheld === 0 && lines.length > 0) {
      const ran = lines.reduce((sum, line) => sum + line.documents, 0)
      out.push(`| all | ${ran} | | | | |`)
    } else if (withheld > 0) out.push('| all | withheld while any stratum is | - | - | - | - |')
    out.push('')
  }
  return out.join('\n')
}

if (import.meta.main) {
  try {
    const [dir, ...resultDirs] = Deno.args
    if (!dir) throw new LocalError('usage: aggregate.ts <evals/local dir>')
    const { records, verifications } = await loadLocal(dir)
    const engines: EngineResults[] = []
    for (const results of resultDirs.length > 0 ? resultDirs : [`${dir}/results`]) {
      for await (const entry of Deno.readDir(results)) {
        if (entry.name.endsWith('.json')) {
          engines.push(readEngine(JSON.parse(await Deno.readTextFile(`${results}/${entry.name}`))))
        }
      }
    }
    engines.sort((a, b) => a.engine.localeCompare(b.engine))
    console.log(aggregateReport(localDocs(records, verifications), engines))
  } catch (error) {
    console.error(error instanceof LocalError ? error.message : 'failed')
    Deno.exit(1)
  }
}
