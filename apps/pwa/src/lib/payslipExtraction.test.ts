import { describe, expect, it } from 'vitest'
import {
  EXTRACTED_AMOUNT_FIELDS,
  EXTRACTED_DATE_FIELDS,
  EXTRACTED_FIELD_LABELS,
  EXTRACTED_TEXT_KEYS,
  extractedTextKey,
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_OUT_OF_CREDIT_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  NOT_PAYSLIP_MESSAGE,
  readExtraction,
  readExtractionFailure,
} from './payslipExtraction'

describe('extractedTextKey', () => {
  it('drops the _cents suffix an amount column carries, and leaves a date alone', () => {
    expect(extractedTextKey('gross_cents')).toBe('gross')
    expect(extractedTextKey('ytd_tax_withheld_cents')).toBe('ytd_tax_withheld')
    expect(extractedTextKey('period_start')).toBe('period_start')
  })
})

describe('EXTRACTED_FIELD_LABELS', () => {
  it('names every field extraction can pre-fill', () => {
    for (const field of [...EXTRACTED_DATE_FIELDS, ...EXTRACTED_AMOUNT_FIELDS]) {
      expect(EXTRACTED_FIELD_LABELS[field]).toBeTruthy()
    }
  })

  it('gives every field a text key the reply reports under', () => {
    for (const field of [...EXTRACTED_DATE_FIELDS, ...EXTRACTED_AMOUNT_FIELDS]) {
      expect(EXTRACTED_TEXT_KEYS).toContain(extractedTextKey(field))
    }
  })
})

describe('readExtraction', () => {
  /** A full reply, as the function sends one. */
  function body(overrides: Record<string, unknown> = {}) {
    return {
      model: 'claude-haiku-4-5-20251001',
      fields: { period_start: '2026-07-06', gross_cents: 4_120_50, net_cents: null },
      text: { period_start: '06/07/2026', gross: '4,120.50', net: null },
      missing: ['net_cents'],
      unreadable: [],
      ...overrides,
    }
  }

  it('keeps the fields, text, and lists a reply actually carries', () => {
    expect(readExtraction(body())).toEqual({
      model: 'claude-haiku-4-5-20251001',
      fields: { period_start: '2026-07-06', gross_cents: 4_120_50 },
      text: { period_start: '06/07/2026', gross: '4,120.50' },
      missing: ['net_cents'],
      unreadable: [],
    })
  })

  it('reads a negative amount as unreadable rather than pre-filling it', () => {
    // A slip printing tax withheld as a deduction parses to a negative, which
    // the column's own `>= 0` check would reject at save.
    const extraction = readExtraction(
      body({
        fields: { tax_withheld_cents: -1_048_00, gross_cents: 4_120_50 },
        text: { tax_withheld: '(1,048.00)' },
        missing: [],
      }),
    )

    expect(extraction!.fields.tax_withheld_cents).toBeUndefined()
    expect(extraction!.unreadable).toEqual(['tax_withheld_cents'])
    // The printed text survives, so the member can read the figure back off it.
    expect(extraction!.text.tax_withheld).toBe('(1,048.00)')
    expect(extraction!.fields.gross_cents).toBe(4_120_50)
  })

  it('drops anything that is not a field it can pre-fill', () => {
    const extraction = readExtraction(
      body({
        fields: { gross_cents: '4120.50', period_start: 6, bogus_cents: 100 },
        text: { gross: 12, bogus: 'x' },
        missing: ['net_cents', 'bogus_cents', 7],
        unreadable: ['gross_cents'],
      }),
    )

    expect(extraction).toEqual({
      model: 'claude-haiku-4-5-20251001',
      fields: {},
      text: {},
      missing: ['net_cents'],
      unreadable: ['gross_cents'],
    })
  })

  it('reads a reply the form could not render as no extraction at all', () => {
    for (const malformed of [
      null,
      undefined,
      'not json',
      {},
      { model: 7, fields: {}, text: {}, missing: [], unreadable: [] },
    ]) {
      expect(readExtraction(malformed)).toBeNull()
    }
  })

  it('takes a reply missing its parts as one carrying nothing', () => {
    expect(
      readExtraction({ model: 'm', fields: 'x', text: null, missing: 1, unreadable: 2 }),
    ).toEqual({ model: 'm', fields: {}, text: {}, missing: [], unreadable: [] })
  })
})

describe('readExtractionFailure', () => {
  it('reads an unset API key as the feature being off, not broken', () => {
    expect(
      readExtractionFailure({
        error: 'Payslip extraction is not configured. Enter the figures by hand.',
        configured: false,
      }),
    ).toEqual({
      status: 'not-configured',
      message: 'Payslip extraction is not configured. Enter the figures by hand.',
    })
  })

  it('reads an exhausted credit balance as its own switched-off state', () => {
    expect(
      readExtractionFailure({
        error: EXTRACTION_OUT_OF_CREDIT_MESSAGE,
        outOfCredit: true,
      }),
    ).toEqual({ status: 'out-of-credit', message: EXTRACTION_OUT_OF_CREDIT_MESSAGE })
  })

  it('keeps the model’s reason for a file that is not a payslip', () => {
    expect(
      readExtractionFailure({
        error: 'That file does not look like a payslip.',
        notPayslip: true,
        reason: 'It is a bank statement.',
      }),
    ).toEqual({
      status: 'not-payslip',
      message: 'That file does not look like a payslip.',
      reason: 'It is a bank statement.',
    })
  })

  it('leaves the reason null when the refusal gave none', () => {
    expect(readExtractionFailure({ notPayslip: true })).toEqual({
      status: 'not-payslip',
      message: NOT_PAYSLIP_MESSAGE,
      reason: null,
    })
  })

  it('prefers the function’s own message, which names the size, type, or wait', () => {
    const message = 'That file is too large to read (24.0 MB; the limit is 20.0 MB).'
    expect(readExtractionFailure({ error: message })).toEqual({ status: 'failed', message })
  })

  it('falls back to a plain message when the body carries none', () => {
    for (const body of [null, undefined, '<html>502</html>', { error: 502 }]) {
      expect(readExtractionFailure(body)).toEqual({
        status: 'failed',
        message: EXTRACTION_FAILED_MESSAGE,
      })
    }
  })

  it('does not read the function’s own internals back to the member', () => {
    for (const error of ['No household membership for this user', 'Could not resolve household']) {
      expect(readExtractionFailure({ error })).toEqual({
        status: 'failed',
        message: EXTRACTION_FAILED_MESSAGE,
      })
    }
  })

  it('states each specific outcome even when its own message is missing', () => {
    expect(readExtractionFailure({ configured: false })).toEqual({
      status: 'not-configured',
      message: EXTRACTION_UNCONFIGURED_MESSAGE,
    })
    expect(readExtractionFailure({ outOfCredit: true })).toEqual({
      status: 'out-of-credit',
      message: EXTRACTION_OUT_OF_CREDIT_MESSAGE,
    })
  })

  it('keeps an unset key and an empty account apart, since the fix differs', () => {
    // Both mean reading is off, but one is a Vault secret to set and the other an
    // account to top up, so neither is ever read as the other.
    expect(readExtractionFailure({ configured: false }).status).toBe('not-configured')
    expect(readExtractionFailure({ outOfCredit: true }).status).toBe('out-of-credit')
    expect(EXTRACTION_OUT_OF_CREDIT_MESSAGE).not.toBe(EXTRACTION_UNCONFIGURED_MESSAGE)
  })
})
