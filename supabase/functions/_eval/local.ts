/**
 * The real-document corpus (tier T3), kept on the machine in `evals/local/`
 * (git-ignored) and never committed.
 *
 * ```
 * evals/local/
 *   config.json            members, labeller, consented arms
 *   identifiers.json       the household's names and addresses (see redact.ts)
 *   originals/<id>.<ext>   the documents
 *   labels/<id>.json       the labeller's record: kind, stratum, consent, raw printed label
 *   verification/<id>.json the other member's independent label of a sampled document
 *   redacted/<id>/         painted pages and redacted text, for arms that leave the machine
 *   layouts/<name>.json    transcribed layouts for re-skinning (see reskin.ts)
 *   results/*.json         engine results keyed by document id (see aggregate.ts)
 * ```
 *
 * A document id is `r-` and the first 12 hex digits of the SHA-256 of its
 * bytes, so no id carries a name. Nothing this module prints names a document,
 * a path or a value: output is counts only.
 *
 * `deno run -A local.ts <dir> add|sample|verify|status|redact|materialize ...`; `redact` and
 * `materialize` run the Swift harness (`--package`, default `evals/foundation-models`).
 */

import type { CorpusDoc, DocKind } from './corpus.ts'
import { type Identifiers, leaks, redactText, termsFor } from './redact.ts'

/** A failure whose message is safe to print: it names no document, path or value. */
export class LocalError extends Error {}

export const ARMS = ['on-device', 'pcc', 'claude'] as const
export type Arm = typeof ARMS[number]

/** Arms that send the document off the machine. */
export const OFF_MACHINE: Arm[] = ['pcc', 'claude']

/** Share of each stratum's labelled documents the other member verifies. */
export const SAMPLE_SHARE = 0.2

export interface Config {
  members: [string, string]
  /** The member who labels; the other verifies. */
  labeller: string
  seed?: number
}

/** One labelled real document. The label is the raw printed text, as the corpus labels are. */
export interface LabelRecord {
  id: string
  /** The member whose document it is; they consent to its use. */
  owner: string
  kind: DocKind
  /** `<type>/<layout class>`; aggregates are reported by stratum. */
  stratum: string
  financialYear: number
  /** Clusters the bootstrap: documents sharing a layout or employer share a source. */
  source?: string
  /** The arms the owner has agreed may read it. */
  arms: Arm[]
  /** Names an employer, donee or counterparty: every arm reads the redacted copy. */
  thirdParties: boolean
  labelledBy: string
  /** False for a scan or photo saved as a PDF, which has no text to read. Default: a PDF has one. */
  textLayer?: boolean
  label?: unknown
}

export interface Verification {
  id: string
  verifiedBy: string
  /** The verifier's own label, made without seeing the labeller's. */
  label?: unknown
  /** The label settled against the document where the two differ. */
  resolved?: unknown
}

export function validateConfig(config: Config): void {
  const [a, b] = config.members
  if (!a || !b || a === b) throw new LocalError('config needs two distinct members')
  if (!config.members.includes(config.labeller)) throw new LocalError('labeller is not a member')
}

export const verifierOf = (config: Config): string =>
  config.members.find((member) => member !== config.labeller)!

/** The id for a document's bytes. */
export async function documentId(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return `r-${
    [...new Uint8Array(hash)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
  }`
}

export function validateRecord(record: LabelRecord, config: Config): void {
  if (!config.members.includes(record.owner)) throw new LocalError('owner is not a member')
  if (record.labelledBy !== config.labeller) throw new LocalError('only the labeller labels')
  if (!['payslip', 'deduction', 'trade', 'other'].includes(record.kind)) {
    throw new LocalError('unknown kind')
  }
  if (!/^[a-z]+\/[a-z0-9-]+$/.test(record.stratum)) {
    throw new LocalError('stratum is <type>/<layout>')
  }
  if (record.kind !== 'other' && (record.label === undefined || record.label === null)) {
    throw new LocalError('a document of a kind needs its label')
  }
  if (record.arms.some((arm) => !ARMS.includes(arm))) throw new LocalError('unknown arm')
}

/**
 * What an arm reads of a document, or null when it may not read it. The owner's
 * consent names the arms; an arm that leaves the machine, and any arm on a
 * document naming third parties, reads only the redacted copy, so without one
 * it reads nothing.
 */
export function inputFor(
  record: LabelRecord,
  arm: Arm,
  hasRedacted: boolean,
): 'original' | 'redacted' | null {
  if (!record.arms.includes(arm)) return null
  if (OFF_MACHINE.includes(arm) || record.thirdParties) return hasRedacted ? 'redacted' : null
  return 'original'
}

/** FNV-1a of the seed and id, so the sample is reproducible and stable as documents are added. */
function rank(id: string, seed: number): number {
  let hash = 0x811c9dc5 ^ seed
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return hash >>> 0
}

/**
 * The documents the verifier labels: `SAMPLE_SHARE` of each stratum, at least
 * one, the lowest-ranked by a seeded hash. A stratum is sampled on its own so a
 * small stratum is still checked.
 */
export function verificationSample(records: LabelRecord[], seed = 831): string[] {
  const byStratum = Map.groupBy(records, (record) => record.stratum)
  return [...byStratum.values()].flatMap((group) => {
    const take = Math.max(1, Math.ceil(SAMPLE_SHARE * group.length))
    return group.map((record) => record.id).sort((a, b) =>
      rank(a, seed) - rank(b, seed) || (a < b ? -1 : 1)
    )
      .slice(0, take)
  }).sort()
}

/** Paths at which two labels differ; no values, so the result is safe to print. */
export function diffPaths(a: unknown, b: unknown, path = ''): string[] {
  if (a === b) return []
  if (
    typeof a === 'object' && typeof b === 'object' && a !== null && b !== null &&
    Array.isArray(a) === Array.isArray(b)
  ) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].flatMap((key) =>
      diffPaths(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}/${key}`,
      )
    )
  }
  return [path || '/']
}

/** The label the eval scores against: the settled one if the two differed, else the labeller's. */
export function finalLabel(record: LabelRecord, verification?: Verification): unknown {
  return verification?.resolved ?? record.label
}

export interface Status {
  labelled: number
  sampled: number
  verified: number
  agreed: number
  /** Differing labels with no resolution yet. */
  unresolved: number
}

export function status(
  records: LabelRecord[],
  verifications: Verification[],
  seed = 831,
): Status {
  const sample = new Set(verificationSample(records, seed))
  const byId = new Map(records.map((record) => [record.id, record]))
  let [agreed, unresolved] = [0, 0]
  for (const verification of verifications) {
    const record = byId.get(verification.id)
    if (!record) continue
    if (diffPaths(record.label, verification.label).length === 0) agreed++
    else if (verification.resolved === undefined) unresolved++
  }
  return {
    labelled: records.length,
    sampled: sample.size,
    verified: verifications.filter((v) => sample.has(v.id)).length,
    agreed,
    unresolved,
  }
}

/** The scored corpus: each labelled document as a corpus document with no rows. */
export function localDocs(records: LabelRecord[], verifications: Verification[]): CorpusDoc[] {
  const byId = new Map(verifications.map((verification) => [verification.id, verification]))
  return records.map((record) =>
    ({
      id: record.id,
      kind: record.kind,
      financialYear: record.financialYear,
      rows: [],
      stratum: record.stratum,
      source: record.source ?? record.id,
      ...(record.kind === 'other' ? {} : { label: finalLabel(record, byId.get(record.id)) }),
    }) as CorpusDoc
  )
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path))
}

async function readAll<T>(dir: string): Promise<T[]> {
  const out: T[] = []
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.endsWith('.json')) out.push(await readJson<T>(`${dir}/${entry.name}`))
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  return out
}

/** Validates parsed local files; sorted by id. */
export function parseLocal(files: {
  config: Config
  records: LabelRecord[]
  verifications: Verification[]
}): { config: Config; records: LabelRecord[]; verifications: Verification[] } {
  validateConfig(files.config)
  for (const record of files.records) validateRecord(record, files.config)
  const byId = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : 1))
  return {
    config: files.config,
    records: byId(files.records),
    verifications: byId(files.verifications),
  }
}

/** The labelled documents and verifications under `dir`. */
export async function loadLocal(dir: string) {
  return parseLocal({
    config: await readJson<Config>(`${dir}/config.json`),
    records: await readAll<LabelRecord>(`${dir}/labels`),
    verifications: await readAll<Verification>(`${dir}/verification`),
  })
}

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

/** Runs the Swift harness with its output discarded: it may carry a document's text. */
async function swift(pkg: string, args: string[]): Promise<void> {
  const { success } = await new Deno.Command('swift', {
    args: ['run', '--package-path', pkg, 'ExtractionEval', ...args],
    stdout: 'null',
    stderr: 'null',
  }).output()
  if (!success) throw new LocalError('the Swift harness failed')
}

async function originalOf(dir: string, id: string): Promise<string> {
  for await (const entry of Deno.readDir(`${dir}/originals`)) {
    if (entry.name.startsWith(`${id}.`)) return `${dir}/originals/${entry.name}`
  }
  throw new LocalError('no original')
}

const exists = (path: string): Promise<boolean> => Deno.stat(path).then(() => true, () => false)

/**
 * Writes `redacted/<id>/` for one document: painted pages (`<id>.png`, `<id>.pN.png`), an
 * image-only `<id>.pdf` and the redacted text `<id>.txt`. Fails, leaving nothing behind, if an
 * identifier survives in either.
 */
async function redactDocument(dir: string, id: string, pkg: string): Promise<void> {
  const known: Identifiers = await readJson(`${dir}/identifiers.json`)
  const original = await originalOf(dir, id)
  const work = `${dir}/work`
  const out = `${dir}/redacted/${id}`
  await Deno.mkdir(work, { recursive: true })
  try {
    await swift(pkg, ['text', original, `${work}/${id}.txt`])
    const text = await Deno.readTextFile(`${work}/${id}.txt`)
    await Deno.writeTextFile(
      `${work}/${id}.terms.json`,
      JSON.stringify({ terms: termsFor(text, known) }),
    )
    const redacted = redactText(text, known)
    if (leaks(redacted, known) > 0) throw new LocalError('redaction incomplete')
    await swift(pkg, ['redact', original, `${work}/${id}.terms.json`, out, id])
    await Deno.writeTextFile(`${out}/${id}.txt`, redacted)
  } catch (error) {
    await Deno.remove(out, { recursive: true }).catch(() => {})
    throw error
  } finally {
    await Deno.remove(work, { recursive: true }).catch(() => {})
  }
}

/**
 * Lays out the documents `arm` may read as a corpus directory the harness runs over
 * (`corpus.json`, `files/`), each as the input `inputFor` allows: the original, normalised to
 * PNG pages, or the redacted copy. Returns how many documents were laid out.
 */
async function materialize(dir: string, arm: Arm, out: string, pkg: string): Promise<number> {
  const { records, verifications } = await loadLocal(dir)
  const docs = new Map(localDocs(records, verifications).map((doc) => [doc.id, doc]))
  const files = `${out}/files`
  await Deno.mkdir(files, { recursive: true })
  const included: CorpusDoc[] = []
  for (const record of records) {
    const redacted = `${dir}/redacted/${record.id}`
    const input = inputFor(record, arm, await exists(`${redacted}/${record.id}.png`))
    if (!input) continue
    const [from, name] = input === 'redacted'
      ? [redacted, record.id]
      : [`${dir}/work-${record.id}`, record.id]
    if (input === 'original') {
      const original = await originalOf(dir, record.id)
      await Deno.mkdir(from, { recursive: true })
      await Deno.writeTextFile(`${from}/none.json`, '{"terms":[]}')
      await swift(pkg, ['redact', original, `${from}/none.json`, from, name])
      if (original.endsWith('.pdf')) await Deno.copyFile(original, `${from}/${name}.pdf`)
      await Deno.writeTextFile(`${from}/${name}.txt`, await swiftText(pkg, original, from))
    }
    for await (const entry of Deno.readDir(from)) {
      if (entry.name.startsWith(`${name}.`) && !entry.name.endsWith('.json')) {
        await Deno.copyFile(`${from}/${entry.name}`, `${files}/${entry.name}`)
      }
    }
    if (input === 'original') await Deno.remove(from, { recursive: true })
    const doc = docs.get(record.id)!
    included.push({
      ...doc,
      textLayer: record.textLayer ?? (await originalOf(dir, record.id)).endsWith('.pdf'),
    })
  }
  await Deno.writeTextFile(`${out}/corpus.json`, JSON.stringify(included))
  return included.length
}

async function swiftText(pkg: string, original: string, work: string): Promise<string> {
  await swift(pkg, ['text', original, `${work}/text.tmp`])
  const text = await Deno.readTextFile(`${work}/text.tmp`)
  await Deno.remove(`${work}/text.tmp`)
  return text
}

/** The CLI; prints counts only, and a failure prints no path or value. */
async function main(args: string[]): Promise<void> {
  const [dir, command, ...rest] = args
  if (!dir || !command) {
    throw new LocalError('usage: local.ts <dir> add|sample|verify|status|redact|materialize')
  }
  const { config, records, verifications } = await loadLocal(dir)
  switch (command) {
    case 'add': {
      const [file] = rest
      const bytes = await Deno.readFile(file)
      const id = await documentId(bytes)
      const extension = file.split('.').pop()!.toLowerCase()
      const record: LabelRecord = {
        id,
        owner: flag(rest, '--owner') ?? '',
        kind: (flag(rest, '--kind') ?? 'other') as DocKind,
        stratum: flag(rest, '--stratum') ?? '',
        financialYear: Number(flag(rest, '--year') ?? 0),
        source: flag(rest, '--source'),
        arms: (flag(rest, '--arms') ?? '').split(',').filter(Boolean) as Arm[],
        thirdParties: rest.includes('--third-parties'),
        labelledBy: config.labeller,
        ...(flag(rest, '--label') ? { label: await readJson(flag(rest, '--label')!) } : {}),
      }
      validateRecord(record, config)
      await Deno.mkdir(`${dir}/originals`, { recursive: true })
      await Deno.mkdir(`${dir}/labels`, { recursive: true })
      await Deno.writeFile(`${dir}/originals/${id}.${extension}`, bytes)
      await Deno.writeTextFile(`${dir}/labels/${id}.json`, JSON.stringify(record, null, 2))
      console.log('added 1 document')
      break
    }
    case 'sample': {
      console.log(`${verificationSample(records, config.seed).length} documents to verify`)
      break
    }
    case 'verify': {
      const [id, labelFile] = rest
      if (!verificationSample(records, config.seed).includes(id)) {
        throw new LocalError('not in sample')
      }
      const record = records.find((r) => r.id === id)!
      const verifier = flag(rest, '--by') ?? verifierOf(config)
      if (verifier === config.labeller) throw new LocalError('the labeller cannot verify')
      const label = await readJson(labelFile)
      const resolvedFile = flag(rest, '--resolved')
      const verification: Verification = {
        id,
        verifiedBy: verifier,
        label,
        ...(resolvedFile ? { resolved: await readJson(resolvedFile) } : {}),
      }
      await Deno.mkdir(`${dir}/verification`, { recursive: true })
      await Deno.writeTextFile(
        `${dir}/verification/${id}.json`,
        JSON.stringify(verification, null, 2),
      )
      const differing = diffPaths(record.label, label).length
      console.log(differing === 0 ? 'agreed' : `${differing} fields differ`)
      break
    }
    case 'status': {
      const s = status(records, verifications, config.seed)
      console.log(
        `labelled ${s.labelled}, sampled ${s.sampled}, verified ${s.verified}, agreed ${s.agreed}, unresolved ${s.unresolved}`,
      )
      break
    }
    case 'redact': {
      const [id] = rest
      if (!records.some((record) => record.id === id)) throw new LocalError('no such document')
      await redactDocument(dir, id, flag(rest, '--package') ?? 'evals/foundation-models')
      console.log('redacted 1 document')
      break
    }
    case 'materialize': {
      const [arm, out] = rest
      if (!ARMS.includes(arm as Arm) || !out) {
        throw new LocalError('usage: materialize <arm> <out dir>')
      }
      const count = await materialize(
        dir,
        arm as Arm,
        out,
        flag(rest, '--package') ?? 'evals/foundation-models',
      )
      console.log(`laid out ${count} documents`)
      break
    }
    default:
      throw new LocalError('unknown command')
  }
}

if (import.meta.main) {
  try {
    await main(Deno.args)
  } catch (error) {
    // Errors from reading local files can carry paths or values; only ours are printed.
    console.error(error instanceof LocalError ? error.message : 'failed')
    Deno.exit(1)
  }
}
