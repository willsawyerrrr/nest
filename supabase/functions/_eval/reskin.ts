/**
 * Re-skinning (tier T2): a real document's layout, with none of its values.
 *
 * A member transcribes a real document into a `Layout`: its rows (labels,
 * column order, page breaks) with every value replaced by a named slot, and a
 * label template that refers to the same slots. `reskin` fills the slots with
 * seeded values and re-derives the label from what it printed, so the result
 * is a corpus document that carries the real layout and nothing of the real
 * data, and can be shared.
 *
 * A slot in a cell or the label is `{name}`. A literal that still looks like a
 * value (an amount, a date, a long number) or an identifier is refused, so a
 * figure left in by mistake is caught before the document is written.
 *
 * `deno run --allow-read --allow-write reskin.ts <layouts dir> <out dir> [--copies n]
 * [--identifiers <identifiers.json>]` writes `<out dir>/reskinned.json`, which `loadDocs` reads.
 */

import { type CorpusDoc, type DocKind, rng, type Row } from './corpus.ts'
import { findIdentifiers, type Identifiers } from './redact.ts'

/** A value generator. Money is cents; `sum` derives a money slot from others. */
export type Slot =
  | { type: 'money'; min: number; max: number; symbol?: string }
  | { type: 'sum'; add: string[]; subtract?: string[]; symbol?: string }
  | { type: 'date'; from: string; to: string; format: 'au' | 'iso' | 'long' }
  | { type: 'int'; min: number; max: number }
  | { type: 'text'; pool: string[] }

export interface Layout {
  /** A generic name; it is the clusters' `source`, so it names no real party. */
  id: string
  kind: DocKind
  /** `<type>/<layout class>`. */
  stratum: string
  financialYear: number
  slots: Record<string, Slot>
  rows: Row[]
  pageBreaks?: number[]
  /** The label with `{slot}` in its strings; absent for a document of no kind. */
  label?: unknown
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number): string => String(n).padStart(2, '0')

const money = (cents: number, symbol = '$'): string =>
  `${cents < 0 ? '-' : ''}${symbol}${
    (Math.abs(cents) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })
  }`

function printDate(date: Date, format: 'au' | 'iso' | 'long'): string {
  const [d, m, y] = [date.getUTCDate(), date.getUTCMonth(), date.getUTCFullYear()]
  if (format === 'iso') return `${y}-${pad(m + 1)}-${pad(d)}`
  if (format === 'long') return `${d} ${MONTHS[m]} ${y}`
  return `${pad(d)}/${pad(m + 1)}/${y}`
}

const between = (next: () => number, low: number, high: number): number =>
  low + Math.floor(next() * (high - low + 1))

/** FNV-1a of a layout id and seed. */
function seedOf(id: string, seed: number): number {
  let hash = 0x811c9dc5 ^ 832
  for (const char of `${id}.${seed}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return hash >>> 0
}

const SLOT = /\{([a-z][a-z0-9_]*)\}/g

/** The slot names a string refers to. */
const slotsIn = (text: string): string[] => [...text.matchAll(SLOT)].map((m) => m[1])

/** Values the literal text of a layout must not carry: they belong in a slot. */
const VALUE = /\d[\d,]*\.\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\d{5,}/

/** Why a layout cannot be re-skinned, or null. Messages name rows and slots, never text. */
export function problems(layout: Layout, known?: Identifiers): string[] {
  const out: string[] = []
  const unknown = (text: string, where: string) => {
    for (const name of slotsIn(text)) if (!layout.slots[name]) out.push(`${where}: unknown slot`)
  }
  layout.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      unknown(cell, `row ${r} cell ${c}`)
      const literal = cell.replace(SLOT, '')
      if (VALUE.test(literal)) out.push(`row ${r} cell ${c}: a value outside a slot`)
      if (known && findIdentifiers(literal, known).length > 0) {
        out.push(`row ${r} cell ${c}: an identifier outside a slot`)
      }
    })
  )
  for (const [name, slot] of Object.entries(layout.slots)) {
    if (slot.type !== 'sum') continue
    for (const ref of [...slot.add, ...(slot.subtract ?? [])]) {
      if (!layout.slots[ref] || layout.slots[ref].type === 'text') out.push(`${name}: bad operand`)
    }
  }
  return out
}

/** Slot values as printed, and the money slots' cents for `sum`. */
function fill(layout: Layout, next: () => number): Record<string, string> {
  const cents: Record<string, number> = {}
  const printed: Record<string, string> = {}
  const pending = Object.entries(layout.slots)
  for (const [name, slot] of pending) {
    switch (slot.type) {
      case 'money': {
        // Round to a whole 5 cents so a figure reads as a real one.
        cents[name] = between(next, slot.min / 5, slot.max / 5) * 5
        printed[name] = money(cents[name], slot.symbol)
        break
      }
      case 'date': {
        const [from, to] = [Date.parse(slot.from), Date.parse(slot.to)]
        const days = Math.round((to - from) / 86_400_000)
        printed[name] = printDate(new Date(from + between(next, 0, days) * 86_400_000), slot.format)
        break
      }
      case 'int':
        printed[name] = String(between(next, slot.min, slot.max))
        break
      case 'text':
        printed[name] = slot.pool[Math.floor(next() * slot.pool.length)]
        break
    }
  }
  for (const [name, slot] of pending) {
    if (slot.type !== 'sum') continue
    cents[name] = slot.add.reduce((a, ref) => a + cents[ref], 0) -
      (slot.subtract ?? []).reduce((a, ref) => a + cents[ref], 0)
    printed[name] = money(cents[name], slot.symbol)
  }
  return printed
}

const substitute = (text: string, values: Record<string, string>): string =>
  text.replace(SLOT, (_, name) => values[name])

function substituteDeep(node: unknown, values: Record<string, string>): unknown {
  if (typeof node === 'string') return substitute(node, values)
  if (Array.isArray(node)) return node.map((item) => substituteDeep(item, values))
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, substituteDeep(value, values)]),
    )
  }
  return node
}

/** Every string in a label, with its path. */
function strings(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]]
  if (Array.isArray(node)) return node.flatMap((item, i) => strings(item, `${path}/${i}`))
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => strings(value, `${path}/${key}`))
  }
  return []
}

/**
 * One seeded document from a layout. The label is re-derived from the printed
 * values, and every string in it must be printed on the page, as a label is the
 * raw printed text.
 */
export function reskin(layout: Layout, seed: number, known?: Identifiers): CorpusDoc {
  const issues = problems(layout, known)
  if (issues.length > 0) throw new Error(`layout ${layout.id}: ${issues.join('; ')}`)
  const values = fill(layout, rng(seedOf(layout.id, seed)))
  const rows = layout.rows.map((row) => row.map((cell) => substitute(cell, values)))
  const label = layout.label === undefined ? undefined : substituteDeep(layout.label, values)
  const printed = rows.flat().join('\n')
  for (const [path, text] of strings(label)) {
    if (text !== '' && !printed.includes(text)) {
      throw new Error(`layout ${layout.id}: label ${path} is not printed`)
    }
  }
  return {
    id: `${layout.id}.s${seed}`,
    kind: layout.kind,
    financialYear: layout.financialYear,
    rows,
    ...(layout.pageBreaks ? { pageBreaks: layout.pageBreaks } : {}),
    stratum: layout.stratum,
    source: layout.id,
    ...(label === undefined ? {} : { label }),
  } as CorpusDoc
}

/** `copies` seeded documents of each layout, in layout order. */
export function reskinAll(layouts: Layout[], copies: number, known?: Identifiers): CorpusDoc[] {
  return layouts.flatMap((layout) =>
    Array.from({ length: copies }, (_, i) => reskin(layout, i, known))
  )
}

if (import.meta.main) {
  const [layoutsDir, outDir, ...rest] = Deno.args
  if (!layoutsDir || !outDir) {
    throw new Error('usage: reskin.ts <layouts dir> <out dir> [--copies n]')
  }
  const flag = (name: string) => rest[rest.indexOf(name) + 1]
  const copies = rest.includes('--copies') ? Number(flag('--copies')) : 5
  const known: Identifiers | undefined = rest.includes('--identifiers')
    ? JSON.parse(await Deno.readTextFile(flag('--identifiers')))
    : undefined
  const layouts: Layout[] = []
  for await (const entry of Deno.readDir(layoutsDir)) {
    if (entry.name.endsWith('.json')) {
      layouts.push(JSON.parse(await Deno.readTextFile(`${layoutsDir}/${entry.name}`)))
    }
  }
  layouts.sort((a, b) => a.id.localeCompare(b.id))
  try {
    const docs = reskinAll(layouts, copies, known)
    await Deno.mkdir(outDir, { recursive: true })
    await Deno.writeTextFile(`${outDir}/reskinned.json`, JSON.stringify(docs, null, 2))
    console.log(`wrote ${docs.length} documents from ${layouts.length} layouts`)
  } catch (error) {
    // Messages name layouts, rows and slots, never a value.
    console.error(error instanceof Error ? error.message : 'failed')
    Deno.exit(1)
  }
}
