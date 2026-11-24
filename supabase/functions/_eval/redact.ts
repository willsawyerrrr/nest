/**
 * Identifier redaction for real documents sent to arms that leave the machine.
 *
 * Names, addresses, TFNs, ABNs and account, BSB and member numbers are found in
 * a document's text; figures and dates are left alone, because they are what is
 * being read. This module works on text: it redacts the text layer and lists the
 * terms the Swift harness (`ExtractionEval redact`) paints out of the raster.
 *
 * The household's own names and addresses come from `identifiers.json` in
 * `evals/local/`; the patterns catch the rest.
 *
 * `deno run --allow-read --allow-write redact.ts terms <identifiers.json> <text> <terms.json>`
 * writes the terms to paint; `redact.ts text <identifiers.json> <text> <redacted.txt>` writes the
 * redacted text and exits non-zero if an identifier survives. Neither prints text or terms.
 */

/** What the household supplies: strings that are always identifiers. */
export interface Identifiers {
  /** Full names, employers and counterparties; each word of three or more letters is redacted too. */
  names: string[]
  /** Full addresses and the lines they are printed as. */
  addresses: string[]
  /** Any other string, redacted as written. */
  other?: string[]
}

export type IdentifierKind = 'known' | 'tfn' | 'abn' | 'number' | 'address'

export interface Span {
  start: number
  end: number
  kind: IdentifierKind
}

export const PLACEHOLDER = '[redacted]'

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** Every match of `pattern` as a span; the pattern must carry the `g` flag. */
function spansOf(text: string, pattern: RegExp, kind: IdentifierKind, group = 0): Span[] {
  return [...text.matchAll(pattern)].flatMap((match) => {
    const value = match[group]
    if (value === undefined) return []
    const start = match.index + (group === 0 ? 0 : match[0].indexOf(value))
    return [{ start, end: start + value.length, kind }]
  })
}

const STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT'
const STREET =
  'St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Pde|Parade|Ct|Court|Pl|Place|Ln|Lane|Hwy|Highway|Cres|Crescent|Blvd|Boulevard|Tce|Terrace|Way|Close|Cl'
const LOCALITY =
  `(?:,?\\s+[A-Z][A-Za-z']+(?:\\s+[A-Z][A-Za-z']+){0,2})?,?\\s+(?:${STATES})\\s+\\d{4}`

const ADDRESS = new RegExp(
  `\\b(?:(?:Unit|Apt|Flat)\\s+)?\\d{1,5}[A-Za-z]?(?:/\\d{1,5})?\\s+[A-Z][A-Za-z']+(?:\\s+[A-Z][A-Za-z']+){0,2}\\s+(?:${STREET})\\b\\.?(?:${LOCALITY})?`,
  'g',
)
const LOCALITY_LINE = new RegExp(
  `\\b[A-Z][A-Za-z']+(?:\\s+[A-Z][A-Za-z']+){0,2},?\\s+(?:${STATES})\\s+\\d{4}\\b`,
  'g',
)
const PO_BOX = /\b(?:PO|GPO)\s+Box\s+\d+\b/gi

const ABN_SPACED = /\b\d{2} \d{3} \d{3} \d{3}\b/g
const ABN_LABELLED = /\b(?:ABN|ACN|A\.B\.N\.?)\b[^\n\d]{0,12}(\d[\d ]{8,13}\d)\b/gi
const TFN_SPACED = /\b\d{3}[ -]\d{3}[ -]\d{3}\b/g
const TFN_LABELLED = /\b(?:TFN|tax file(?: number)?)\b[^\n\d]{0,12}(\d[\d -]{7,10}\d)\b/gi

const NUMBER_KEYWORD =
  /\b(?:account|acct|a\/c|bsb|member(?:ship)?|customer|client|employee|payroll|policy|HIN|SRN|card|biller)\b/i
const NUMBER_RUN = /\b[A-Z]{0,4}\d[\d -]{3,}\d\b/g
const DATE_WITH_SPACES = /^\d{1,2}[ -]\d{1,2}[ -]\d{4}$/
const DIGITS_ONLY = /^\s*[A-Z]{0,4}\d[\d -]{3,}\d\s*$/

/** Account, BSB, member and similar numbers: a digit run on, or on the line after, a keyword. */
function numberSpans(text: string): Span[] {
  const spans: Span[] = []
  let offset = 0
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (NUMBER_KEYWORD.test(line)) {
      const found = spansOf(line, NUMBER_RUN, 'number').filter((span) =>
        !DATE_WITH_SPACES.test(line.slice(span.start, span.end))
      )
      for (const span of found) {
        spans.push({ ...span, start: span.start + offset, end: span.end + offset })
      }
      const next = lines[index + 1]
      if (found.length === 0 && next !== undefined && DIGITS_ONLY.test(next)) {
        const start = offset + line.length + 1 + next.search(/\S/)
        spans.push({ start, end: offset + line.length + 1 + next.trimEnd().length, kind: 'number' })
      }
    }
    offset += line.length + 1
  })
  return spans
}

/** The strings the household supplies, with each word of a name added. */
export function knownTerms(known: Identifiers): string[] {
  const words = known.names.flatMap((name) => name.split(/\s+/).filter((word) => word.length >= 3))
  return [...new Set([...known.names, ...known.addresses, ...(known.other ?? []), ...words])]
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length)
}

function knownSpans(text: string, known: Identifiers): Span[] {
  return knownTerms(known).flatMap((term) =>
    spansOf(text, new RegExp(`(?<![A-Za-z0-9])${escape(term)}(?![A-Za-z0-9])`, 'gi'), 'known')
  )
}

/** Overlapping and touching spans merged into one, in order. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Span[] = []
  for (const span of sorted) {
    const last = out.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else out.push({ ...span })
  }
  return out
}

/** Where identifiers are in `text`, merged and in order. Figures and dates are not identifiers. */
export function findIdentifiers(text: string, known: Identifiers): Span[] {
  return merge([
    ...knownSpans(text, known),
    ...spansOf(text, ABN_SPACED, 'abn'),
    ...spansOf(text, ABN_LABELLED, 'abn', 1),
    ...spansOf(text, TFN_SPACED, 'tfn'),
    ...spansOf(text, TFN_LABELLED, 'tfn', 1),
    ...numberSpans(text),
    ...spansOf(text, ADDRESS, 'address'),
    ...spansOf(text, LOCALITY_LINE, 'address'),
    ...spansOf(text, PO_BOX, 'address'),
  ])
}

/** `text` with every identifier replaced by a placeholder. */
export function redactText(text: string, known: Identifiers): string {
  let out = ''
  let at = 0
  for (const span of findIdentifiers(text, known)) {
    out += text.slice(at, span.start) + PLACEHOLDER
    at = span.end
  }
  return out + text.slice(at)
}

/**
 * The strings to paint out of a document's raster: every identifier found in
 * its text, and every string the household supplies, which the raster's own
 * recognised text may carry where the text layer does not.
 */
export function termsFor(text: string, known: Identifiers): string[] {
  const found = findIdentifiers(text, known).map((span) => text.slice(span.start, span.end))
  return [...new Set([...found, ...knownTerms(known)])]
}

/** How many identifiers remain in redacted text; zero when the redaction is complete. */
export function leaks(redacted: string, known: Identifiers): number {
  return findIdentifiers(redacted.replaceAll(PLACEHOLDER, ''), known).length
}

if (import.meta.main) {
  const [command, identifiersFile, input, output] = Deno.args
  if (!['terms', 'text'].includes(command) || !output) {
    throw new Error('usage: redact.ts terms|text <identifiers.json> <text> <output>')
  }
  const known: Identifiers = JSON.parse(await Deno.readTextFile(identifiersFile))
  const text = await Deno.readTextFile(input)
  if (command === 'terms') {
    await Deno.writeTextFile(output, JSON.stringify({ terms: termsFor(text, known) }))
  } else {
    const redacted = redactText(text, known)
    await Deno.writeTextFile(output, redacted)
    if (leaks(redacted, known) > 0) {
      console.error('redaction incomplete: an identifier survives')
      Deno.exit(1)
    }
  }
}
