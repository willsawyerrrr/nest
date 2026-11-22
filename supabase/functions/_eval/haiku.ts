/**
 * Runs the corpus through the server extraction path: the same Haiku extractors
 * the `payslip-extract`, `deduction-extract` and `trade-extract` functions call,
 * with the same prompts, tool schemas and media handling.
 *
 * `ANTHROPIC_API_KEY=… deno run --allow-env --allow-read --allow-write --allow-net
 * haiku.ts <dir> pdf|png` reads `<dir>/corpus.json` and the rendered
 * `<dir>/files/<id>.<media>`, and writes `<dir>/results/haiku-<media>.json`.
 */

import { anthropicExtractor as deductionExtractor } from '../deduction-extract/model.ts'
import { anthropicExtractor as payslipExtractor } from '../payslip-extract/model.ts'
import { anthropicExtractor as tradeExtractor } from '../trade-extract/model.ts'
import type { CorpusDoc, DocKind } from './corpus.ts'
import { type EngineResults, resultKey, type RunResult } from './score.ts'

const MEDIA = {
  pdf: 'application/pdf',
  png: 'image/png',
} as const

type ExtractorKind = Exclude<DocKind, 'other'>
const EXTRACTORS: ExtractorKind[] = ['payslip', 'deduction', 'trade']

async function main(): Promise<void> {
  const [dir, media] = Deno.args as [string, keyof typeof MEDIA]
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!dir || !(media in MEDIA) || !apiKey) {
    throw new Error('usage: ANTHROPIC_API_KEY=… haiku.ts <dir> pdf|png')
  }
  const corpus: CorpusDoc[] = JSON.parse(await Deno.readTextFile(`${dir}/corpus.json`))
  const run = {
    payslip: payslipExtractor(apiKey),
    deduction: deductionExtractor(apiKey),
    trade: tradeExtractor(apiKey),
  }
  const results: EngineResults['results'] = {}

  for (const doc of corpus) {
    const bytes = await Deno.readFile(`${dir}/files/${doc.id}.${media}`)
    const file = { mediaType: MEDIA[media], bytes }
    for (const extractor of EXTRACTORS) {
      if (doc.kind !== extractor && doc.kind !== 'other') continue
      const started = performance.now()
      const outcome = extractor === 'deduction'
        ? await run.deduction(file, doc.financialYear, 'work_expense')
        : await run[extractor](file, doc.financialYear)
      const result: RunResult = outcome.ok
        ? {
          raw: 'document' in outcome ? outcome.document : outcome.fields,
          ms: Math.round(performance.now() - started),
        }
        : { error: outcome.failure, ms: Math.round(performance.now() - started) }
      results[resultKey(doc.id, extractor)] = result
      console.log(resultKey(doc.id, extractor), outcome.ok ? 'ok' : outcome.failure)
    }
  }
  await Deno.mkdir(`${dir}/results`, { recursive: true })
  const engine = `haiku-${media}`
  await Deno.writeTextFile(
    `${dir}/results/${engine}.json`,
    JSON.stringify({ engine, results } satisfies EngineResults, null, 2),
  )
}

if (import.meta.main) await main()
