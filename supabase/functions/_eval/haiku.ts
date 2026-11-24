/**
 * Runs the corpus through the Claude arms of the extraction eval: Haiku 4.5,
 * Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.2, with the production extractors'
 * prompts, tool schemas and field readers.
 *
 * Opus 5.5, Sonnet 5.5 and Fable 5.2 reject the forced `tool_choice` the
 * production extractors use, so every arm, Haiku 4.5 included, gets a tool with
 * `tool_choice: auto` and a system instruction naming the tool. The receipt and
 * trade tools are `strict`; the payslip tool is not, as its schema exceeds the
 * API's limit of 16 union-typed strict parameters. The 5.x arms run once per
 * effort level, set explicitly; no sampling parameter is sent.
 *
 * `ANTHROPIC_API_KEY=… deno run --allow-env --allow-read --allow-write --allow-net
 * --allow-run=git haiku.ts <dir> [--arms a,b] [--efforts low,medium,high]
 * [--media pdf,png,text] [--repeats 5] [--only id,id] [--dry-run] [--force]` reads
 * `<dir>/corpus.json`, `strata.json` and the noisy variants in `manifest.json` (each
 * scored against its source document's label) and the rendered
 * `<dir>/files/<id>.<pdf|png|txt>`, prints the
 * projected cost, asks for confirmation, and writes one
 * `<dir>/results/claude-<arm>[-<effort>]-<media>.json` per engine.
 */

import Anthropic from '@anthropic-ai/sdk'
import { encodeBase64 } from '@std/encoding/base64'
import { buildSystemPrompt as deductionPrompt, RECEIPT_TOOL } from '../deduction-extract/model.ts'
import { readRawFields as readDeduction } from '../deduction-extract/fields.ts'
import { buildSystemPrompt as payslipPrompt, PAYSLIP_TOOL } from '../payslip-extract/model.ts'
import { readRawFields as readPayslip } from '../payslip-extract/fields.ts'
import { buildSystemPrompt as tradePrompt, TRADES_TOOL } from '../trade-extract/model.ts'
import { readRawFields as readTrades } from '../trade-extract/fields.ts'
import type { CorpusDoc, DocKind } from './corpus.ts'
import { loadDocs } from './noise.ts'
import { type EngineResults, resultKey, type RunResult } from './score.ts'

export type ExtractorKind = Exclude<DocKind, 'other'>
export const EXTRACTORS: ExtractorKind[] = ['payslip', 'deduction', 'trade']

/** Whether each extractor's tool is sent `strict`; the payslip schema exceeds the union limit. */
export const STRICT: Record<ExtractorKind, boolean> = {
  payslip: false,
  deduction: true,
  trade: true,
}

export const MEDIA = ['pdf', 'png', 'text'] as const
export type Media = typeof MEDIA[number]

export const EFFORTS = ['low', 'medium', 'high'] as const
export type Effort = typeof EFFORTS[number]

export type ArmId = 'haiku-4-5' | 'haiku-5-5' | 'sonnet-5-5' | 'opus-5-5' | 'fable-5-2'

export interface Arm {
  id: ArmId
  model: string
  /** Nanodollars per input and output token, i.e. dollars per million tokens times 1000. */
  inputNano: number
  outputNano: number
  /** A dearer tier for prompts past a size, where the model has one. */
  longPrompt?: { above: number; inputNano: number; outputNano: number }
  /** Adaptive thinking is sent; Fable thinks always and takes no `thinking` parameter. */
  thinking: 'none' | 'adaptive' | 'always'
  /** The arm runs once per effort level; Haiku 4.5 has no effort. */
  effort: boolean
}

/** Prices from the Claude API skill's model table (cached 2026-11-03); re-check before a run. */
export const ARMS: Record<ArmId, Arm> = {
  'haiku-4-5': {
    id: 'haiku-4-5',
    model: 'claude-haiku-4-5',
    inputNano: 1_000,
    outputNano: 5_000,
    thinking: 'none',
    effort: false,
  },
  'haiku-5-5': {
    id: 'haiku-5-5',
    model: 'claude-haiku-5-5',
    inputNano: 100,
    outputNano: 500,
    longPrompt: { above: 100_000, inputNano: 500, outputNano: 2_500 },
    thinking: 'adaptive',
    effort: true,
  },
  'sonnet-5-5': {
    id: 'sonnet-5-5',
    model: 'claude-sonnet-5-5',
    inputNano: 2_000,
    outputNano: 10_000,
    thinking: 'adaptive',
    effort: true,
  },
  'opus-5-5': {
    id: 'opus-5-5',
    model: 'claude-opus-5-5',
    inputNano: 4_000,
    outputNano: 20_000,
    thinking: 'adaptive',
    effort: true,
  },
  'fable-5-2': {
    id: 'fable-5-2',
    model: 'claude-fable-5-2',
    inputNano: 8_000,
    outputNano: 40_000,
    thinking: 'always',
    effort: true,
  },
}

interface ExtractorSpec {
  tool: Anthropic.Tool
  system: (financialYear: number) => string
  ask: string
  /** The production output cap; thinking arms get `THINKING_ALLOWANCE` more. */
  maxTokens: number
  read: (input: unknown) => unknown
  /** The assumed per-document token profile (design doc, Cost model). */
  profile: { input: number; output: number }
}

const EXTRACTOR_SPECS: Record<ExtractorKind, ExtractorSpec> = {
  payslip: {
    tool: PAYSLIP_TOOL,
    system: payslipPrompt,
    ask: 'Read this payslip and record its fields.',
    maxTokens: 2048,
    read: readPayslip,
    profile: { input: 5_000, output: 800 },
  },
  deduction: {
    tool: RECEIPT_TOOL,
    system: (financialYear) => deductionPrompt('work_expense', financialYear),
    ask: 'Read this receipt and record its fields.',
    maxTokens: 512,
    read: readDeduction,
    profile: { input: 2_000, output: 200 },
  },
  trade: {
    tool: TRADES_TOOL,
    system: tradePrompt,
    ask: 'Read this document and record its trades.',
    maxTokens: 12_288,
    read: readTrades,
    profile: { input: 8_000, output: 1_500 },
  },
}

/** Output tokens a thinking arm may spend on top of the production cap. */
export const THINKING_ALLOWANCE = 8_000

const REQUEST_TIMEOUT_MS = 300_000
const MAX_RETRIES = 2

const PDF = 'application/pdf'
const PNG = 'image/png'

/** What the model is given for one document. */
export type Input = { media: 'pdf' | 'png'; bytes: Uint8Array } | { media: 'text'; text: string }

/** The slice of the Messages API the runner uses, so a stub can stand in for the client. */
export interface MessagesClient {
  messages: { create(params: MessageRequest): Promise<Anthropic.Message> }
}

/** The request body. Typed loosely: it carries parameters older SDK types do not name. */
export interface MessageRequest {
  model: string
  max_tokens: number
  system: string
  tools: Array<Anthropic.Tool & { strict?: boolean }>
  tool_choice: { type: 'auto' }
  thinking?: { type: 'adaptive' }
  output_config?: { effort: Effort }
  messages: Anthropic.MessageParam[]
}

function userContent(ask: string, input: Input): Anthropic.ContentBlockParam[] {
  if (input.media === 'text') {
    return [{ type: 'text', text: `${ask}\n\nDocument text:\n${input.text}` }]
  }
  const data = encodeBase64(input.bytes)
  const file: Anthropic.ContentBlockParam = input.media === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: PDF, data } }
    : { type: 'image', source: { type: 'base64', media_type: PNG, data } }
  return [file, { type: 'text', text: ask }]
}

/**
 * The request for one document under one extractor: the production prompt and
 * tool, made `strict` where `STRICT` says so and left to the model with `auto`,
 * plus an instruction naming the tool. Neither `temperature`, `top_p` nor `top_k` is sent.
 */
export function buildRequest(
  arm: Arm,
  effort: Effort | null,
  kind: ExtractorKind,
  financialYear: number,
  input: Input,
): MessageRequest {
  const spec = EXTRACTOR_SPECS[kind]
  const thinks = arm.thinking !== 'none'
  return {
    model: arm.model,
    max_tokens: spec.maxTokens + (thinks ? THINKING_ALLOWANCE : 0),
    system:
      `${spec.system(financialYear)}\n\nRecord your answer by calling the \`${spec.tool.name}\` ` +
      'tool exactly once. Do not reply in prose.',
    tools: [STRICT[kind] ? { ...spec.tool, strict: true } : spec.tool],
    tool_choice: { type: 'auto' },
    ...(arm.thinking === 'adaptive' ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(arm.effort && effort ? { output_config: { effort } } : {}),
    messages: [{ role: 'user', content: userContent(spec.ask, input) }],
  }
}

/** The cost of a run in nanodollars, thinking billed as output (it is in `output_tokens`). */
export function costNanoUsd(arm: Arm, inputTokens: number, outputTokens: number): number {
  const tier = arm.longPrompt && inputTokens > arm.longPrompt.above ? arm.longPrompt : arm
  return inputTokens * tier.inputNano + outputTokens * tier.outputNano
}

export interface ClaudeRunResult extends RunResult {
  effort?: Effort
  inputTokens?: number
  /** Output tokens as billed, thinking included. */
  outputTokens?: number
  /** Nanodollars, from the price table. */
  costNanoUsd?: number
  stopReason?: string | null
}

export interface ClaudeEngineResults extends EngineResults {
  results: Record<string, ClaudeRunResult>
  repeats: Record<string, ClaudeRunResult[]>
  meta: {
    arm: ArmId
    model: string
    effort: Effort | null
    media: Media
    /** Whether each extractor's tool was sent `strict`. */
    strict: Record<ExtractorKind, boolean>
    repeats: number
    corpusSha256: string
    commit: string | null
    startedAt: string
  }
}

/** Runs one document through one extractor once, timing the call and costing its usage. */
export async function runOnce(
  client: MessagesClient,
  arm: Arm,
  effort: Effort | null,
  kind: ExtractorKind,
  financialYear: number,
  input: Input,
): Promise<ClaudeRunResult> {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  const base = effort ? { effort } : {}
  let message: Anthropic.Message
  try {
    message = await client.messages.create(buildRequest(arm, effort, kind, financialYear, input))
  } catch (error) {
    const status = error instanceof Anthropic.APIError ? error.status : undefined
    console.error('Anthropic request failed:', status ?? (error as Error).message)
    const timeout = error instanceof Anthropic.APIConnectionTimeoutError
    return {
      ...base,
      error: timeout ? 'timeout' : `api_error${status ? `:${status}` : ''}`,
      ms: elapsed(),
    }
  }
  const ms = elapsed()
  const inputTokens = message.usage.input_tokens
  const outputTokens = message.usage.output_tokens
  const usage = {
    ...base,
    ms,
    promptTokens: inputTokens,
    inputTokens,
    outputTokens,
    costNanoUsd: costNanoUsd(arm, inputTokens, outputTokens),
    stopReason: message.stop_reason,
  }
  if (message.stop_reason === 'refusal') return { ...usage, error: 'refused' }
  if (message.stop_reason === 'max_tokens') return { ...usage, error: 'cut_short' }
  const toolUse = message.content.find((block) => block.type === 'tool_use')
  if (!toolUse) return { ...usage, error: 'no_tool_call' }
  const raw = EXTRACTOR_SPECS[kind].read(toolUse.input)
  return raw ? { ...usage, raw } : { ...usage, error: 'malformed' }
}

export function documentExtractors(doc: CorpusDoc, media?: Media): ExtractorKind[] {
  // A variant whose PDF is only a picture has no text to read.
  if (media === 'text' && doc.textLayer === false) return []
  return EXTRACTORS.filter((kind) => doc.kind === kind || doc.kind === 'other')
}

/** The text file of a document; a born-digital variant reads its source document's. */
export function textFile(doc: CorpusDoc): string {
  return doc.profile ? doc.id.slice(0, -doc.profile.length - 1) : doc.id
}

/** The engine name the scorer and report know the arm by. */
export function engineName(arm: ArmId, effort: Effort | null, media: Media): string {
  return `claude-${arm}${effort ? `-${effort}` : ''}-${media}`
}

export interface EngineSpec {
  arm: Arm
  effort: Effort | null
  media: Media
  name: string
}

export function engineSpecs(arms: ArmId[], efforts: Effort[], medias: Media[]): EngineSpec[] {
  return arms.flatMap((id) => {
    const arm = ARMS[id]
    return (arm.effort ? efforts : [null]).flatMap((effort) =>
      medias.map((media) => ({ arm, effort, media, name: engineName(id, effort, media) }))
    )
  })
}

export interface Projection {
  engines: Array<{ name: string; runs: number; costNanoUsd: number }>
  runs: number
  costNanoUsd: number
}

/**
 * The projected spend from the manifest: every document under each extractor it
 * is run through, times repeats, at the design's assumed token profile.
 * Thinking is excluded, so the 5.x arms spend more than this.
 */
export function projectCost(
  corpus: CorpusDoc[],
  specs: EngineSpec[],
  repeats: number,
): Projection {
  const engines = specs.map(({ arm, name, media }) => {
    const perEngine = corpus.flatMap((doc) => documentExtractors(doc, media))
    const costNano = perEngine.reduce((sum, kind) => {
      const { input, output } = EXTRACTOR_SPECS[kind].profile
      return sum + costNanoUsd(arm, input, output) * repeats
    }, 0)
    return { name, runs: perEngine.length * repeats, costNanoUsd: costNano }
  })
  return {
    engines,
    runs: engines.reduce((sum, e) => sum + e.runs, 0),
    costNanoUsd: engines.reduce((sum, e) => sum + e.costNanoUsd, 0),
  }
}

export const formatUsd = (nano: number): string => `$${(nano / 1e9).toFixed(2)}`

export interface Corpus {
  docs: CorpusDoc[]
  /** Reads a document's input for a media path. */
  load(doc: CorpusDoc, media: Media): Promise<Input>
}

/** Runs every document through every extractor it applies to, `repeats` times. */
export async function runEngine(
  client: MessagesClient,
  spec: EngineSpec,
  corpus: Corpus,
  repeats: number,
  meta: Omit<
    ClaudeEngineResults['meta'],
    'arm' | 'model' | 'effort' | 'media' | 'strict' | 'repeats'
  >,
  log: (line: string) => void = console.log,
): Promise<ClaudeEngineResults> {
  const results: ClaudeEngineResults['results'] = {}
  const all: ClaudeEngineResults['repeats'] = {}
  for (const doc of corpus.docs) {
    const kinds = documentExtractors(doc, spec.media)
    if (kinds.length === 0) continue
    const input = await corpus.load(doc, spec.media)
    for (const kind of kinds) {
      const runs: ClaudeRunResult[] = []
      for (let i = 0; i < repeats; i++) {
        runs.push(await runOnce(client, spec.arm, spec.effort, kind, doc.financialYear, input))
      }
      const key = resultKey(doc.id, kind)
      results[key] = runs[0]
      all[key] = runs
      log(`${spec.name} ${key} ${runs.map((run) => run.error ?? 'ok').join(' ')}`)
    }
  }
  return {
    engine: spec.name,
    results,
    repeats: all,
    meta: {
      arm: spec.arm.id,
      model: spec.arm.model,
      effort: spec.effort,
      media: spec.media,
      strict: STRICT,
      repeats,
      ...meta,
    },
  }
}

interface Options {
  dir: string
  arms: ArmId[]
  efforts: Effort[]
  medias: Media[]
  repeats: number
  only: string[] | null
  dryRun: boolean
  force: boolean
}

function list<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T[] {
  if (value === undefined) return [...allowed]
  const items = value.split(',')
  const bad = items.find((item) => !(allowed as readonly string[]).includes(item))
  if (bad) throw new Error(`--${flag}: unknown "${bad}" (one of ${allowed.join(', ')})`)
  return items as T[]
}

export function parseArgs(args: string[]): Options {
  const flags = new Map<string, string>()
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) positional.push(args[i])
    else if (args[i] === '--dry-run' || args[i] === '--force') flags.set(args[i].slice(2), '')
    else flags.set(args[i].slice(2), args[++i] ?? '')
  }
  const known = ['arms', 'efforts', 'media', 'repeats', 'only', 'dry-run', 'force']
  const unknown = [...flags.keys()].find((flag) => !known.includes(flag))
  const repeats = Number(flags.get('repeats') ?? 5)
  if (positional.length !== 1 || unknown || !Number.isInteger(repeats) || repeats < 1) {
    throw new Error(
      'usage: haiku.ts <dir> [--arms a,b] [--efforts low,medium,high] [--media pdf,png,text] ' +
        '[--repeats 5] [--only id,id] [--dry-run] [--force]' +
        (unknown ? `\nunknown flag --${unknown}` : ''),
    )
  }
  return {
    dir: positional[0],
    arms: list(flags.get('arms'), Object.keys(ARMS) as ArmId[], 'arms'),
    efforts: list(flags.get('efforts'), EFFORTS, 'efforts'),
    medias: list(flags.get('media'), MEDIA, 'media'),
    repeats,
    only: flags.has('only') ? flags.get('only')!.split(',') : null,
    dryRun: flags.has('dry-run'),
    force: flags.has('force'),
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function gitCommit(): Promise<string | null> {
  try {
    const { stdout, success } = await new Deno.Command('git', { args: ['rev-parse', 'HEAD'] })
      .output()
    return success ? new TextDecoder().decode(stdout).trim() : null
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const options = parseArgs(Deno.args)
  const { docs: all, text: corpusText } = await loadDocs(options.dir)
  const docs = options.only ? all.filter((doc) => options.only!.includes(doc.id)) : all
  const resultsDir = `${options.dir}/results`
  const todo: EngineSpec[] = []
  for (const spec of engineSpecs(options.arms, options.efforts, options.medias)) {
    if (options.force || !(await exists(`${resultsDir}/${spec.name}.json`))) todo.push(spec)
    else console.log(`skipping ${spec.name}: results exist (--force to rerun)`)
  }

  const projection = projectCost(docs, todo, options.repeats)
  for (const e of projection.engines) {
    console.log(
      `${e.name.padEnd(36)} ${String(e.runs).padStart(6)} runs  ${formatUsd(e.costNanoUsd)}`,
    )
  }
  console.log(
    `projected ${projection.runs} runs, ${formatUsd(projection.costNanoUsd)} excluding thinking ` +
      '(5.x arms cost more: thinking is billed as output)',
  )
  if (options.dryRun || todo.length === 0) return

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (--dry-run needs no key)')
  if (prompt('This spends real money. Type "yes" to continue:') !== 'yes') {
    console.log('aborted; nothing was spent')
    return
  }

  const client = new Anthropic({ apiKey, maxRetries: MAX_RETRIES, timeout: REQUEST_TIMEOUT_MS })
  const corpus: Corpus = {
    docs,
    load: async (doc, media) => {
      if (media === 'text') {
        return { media, text: await Deno.readTextFile(`${options.dir}/files/${textFile(doc)}.txt`) }
      }
      return { media, bytes: await Deno.readFile(`${options.dir}/files/${doc.id}.${media}`) }
    },
  }
  const meta = {
    corpusSha256: await sha256(corpusText),
    commit: await gitCommit(),
    startedAt: new Date().toISOString(),
  }
  await Deno.mkdir(resultsDir, { recursive: true })
  let spent = 0
  for (const spec of todo) {
    const output = await runEngine(client, spec, corpus, options.repeats, meta)
    await Deno.writeTextFile(`${resultsDir}/${spec.name}.json`, JSON.stringify(output, null, 2))
    const cost = Object.values(output.repeats).flat().reduce((s, r) => s + (r.costNanoUsd ?? 0), 0)
    spent += cost
    console.log(`${spec.name}: ${formatUsd(cost)} (${formatUsd(spent)} so far)`)
  }
}

if (import.meta.main) await main()
