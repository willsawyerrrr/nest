/**
 * Converts an amount as printed on a payslip into integer cents.
 *
 * The model reports each amount as the literal text it read; this module — not
 * the model — turns that text into money. Asking a model to multiply by 100
 * invites a silent arithmetic slip in a tax figure, so the conversion is
 * deterministic TypeScript, done with integer arithmetic on the digit strings.
 * `parseFloat(text) * 100` is never used: `parseFloat('8.29') * 100` is
 * 828.9999999999999, which truncates to the wrong cents.
 *
 * Anything that is not unambiguously an amount yields `null`. A null is a field
 * the member fills in themselves; a wrong number is a wrong tax figure they may
 * never notice, so every uncertain case resolves to null.
 */

/**
 * Amounts that parse: optional thousands groups, an optional 1–2 digit cents
 * part, and a bare cents part (`.50`). A comma is only a thousands separator
 * between full digit groups, so `12,34` (a comma used as a decimal mark) fails
 * rather than being guessed at.
 */
const AMOUNT = /^(?:(\d{1,3}(?:,\d{3})+)|(\d*))(?:\.(\d{1,2}))?$/

/** Leading currency marks an AU payslip may print before the digits. */
const CURRENCY = /^(?:AUD|AU\$|A\$|\$)/i

/**
 * Text the model uses to mean "this field is not on the slip". Treated as
 * absent rather than unreadable, so an empty field is not flagged as a misread.
 */
const PLACEHOLDERS = new Set([
  '',
  '-',
  '–',
  '—',
  '.',
  'null',
  'nil',
  'none',
  'n/a',
  'na',
  'notshown',
  'notstated',
  'notapplicable',
  'unknown',
])

/**
 * Dollar digits beyond this can no longer be held exactly once multiplied into
 * cents (a safe integer holds ~9.0e15 cents), so they are rejected rather than
 * silently rounded.
 */
const MAX_DOLLAR_DIGITS = 13

/** True when `text` is one of the placeholders the model uses for an absent field. */
export function isPlaceholder(text: string): boolean {
  return PLACEHOLDERS.has(text.replace(/\s/g, '').toLowerCase())
}

/**
 * Parses printed money text into integer cents, or `null` when the text is not
 * unambiguously an amount.
 *
 * Handles thousands separators, a leading `$` / `A$` / `AUD` in either order
 * with the sign, absent cents (`4120` → `412000`), whitespace (including the
 * non-breaking spaces payroll PDFs emit), and both negative conventions:
 * parenthesised (`(1,234.56)`) and signed (`-45.00`, `45.00-`).
 */
export function parseCents(raw: unknown): number | null {
  if (typeof raw !== 'string') return null

  // Whitespace is never meaningful inside an amount.
  let text = raw.replace(/\s/g, '')
  if (isPlaceholder(text)) return null

  let negative = false

  // Accounting negatives wrap the whole amount: ($1,234.56).
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1)
  }

  // A trailing minus is the other payroll convention: 1,234.56-.
  if (text.endsWith('-')) {
    if (negative) return null // Two negative markers: not a readable amount.
    negative = true
    text = text.slice(0, -1)
  }

  // A sign and a currency mark can appear in either order: -$45, $-45.
  let signed = negative
  for (;;) {
    const currency = CURRENCY.exec(text)
    if (currency) {
      text = text.slice(currency[0].length)
      continue
    }
    if (!signed && (text.startsWith('-') || text.startsWith('+'))) {
      signed = true
      negative = text.startsWith('-')
      text = text.slice(1)
      continue
    }
    break
  }

  const match = AMOUNT.exec(text)
  if (!match || !/\d/.test(text)) return null

  const [, grouped, plain, fraction] = match
  const dollarDigits = (grouped ? grouped.replaceAll(',', '') : plain) || '0'
  if (dollarDigits.replace(/^0+/, '').length > MAX_DOLLAR_DIGITS) return null

  // Integer arithmetic on the two digit strings — no fractional value ever exists.
  const cents = Number(dollarDigits) * 100 + Number((fraction ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null

  return negative && cents !== 0 ? -cents : cents
}

/**
 * Parses a date the model reports as ISO `YYYY-MM-DD`, or `null` when it is not
 * a real calendar date. The round-trip rejects an impossible day (`2026-02-31`)
 * that the regex alone would accept.
 */
export function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === text ? text : null
}
