import { describe, expect, it } from 'vitest'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_KEY_REJECTED_MESSAGE,
  EXTRACTION_OUT_OF_CREDIT_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  NOT_RECEIPT_MESSAGE,
  readExtraction,
  readExtractionFailure,
} from './deductionExtraction'

describe('readExtraction', () => {
  /** A full reply, as the function sends one. */
  function body(overrides: Record<string, unknown> = {}) {
    return {
      model: 'claude-haiku-4-5-20251001',
      fields: { description: 'Officeworks', deduction_date: '2026-08-05', amount_cents: 124_50 },
      text: { amount: '124.50', deduction_date: '2026-08-05' },
      missing: [],
      unreadable: [],
      ...overrides,
    }
  }

  it('keeps the fields the form pre-fills from, and nothing else', () => {
    expect(readExtraction(body())).toEqual({
      model: 'claude-haiku-4-5-20251001',
      fields: { description: 'Officeworks', deduction_date: '2026-08-05', amount_cents: 124_50 },
    })
  })

  it('leaves a negative amount blank rather than pre-filling it', () => {
    // A receipt printing a refund as a negative parses that way, which the
    // column's own `>= 0` check would reject at save. The sign is not guessed
    // at: the field is left for the member to type off the document.
    const extraction = readExtraction(body({ fields: { amount_cents: -124_50 } }))

    expect(extraction!.fields.amount_cents).toBeUndefined()
  })

  it('drops anything that is not a field it can pre-fill', () => {
    const extraction = readExtraction(
      body({ fields: { amount_cents: '124.50', description: 7, bogus_cents: 100 } }),
    )

    expect(extraction).toEqual({ model: 'claude-haiku-4-5-20251001', fields: {} })
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
    expect(readExtraction({ model: 'm', fields: 'x' })).toEqual({ model: 'm', fields: {} })
  })
})

describe('readExtractionFailure', () => {
  it('reads an unset API key as the feature being off, not broken', () => {
    expect(
      readExtractionFailure({
        error: 'Receipt extraction is not configured. Enter the details by hand.',
        configured: false,
      }),
    ).toEqual({
      status: 'not-configured',
      message: 'Receipt extraction is not configured. Enter the details by hand.',
    })
  })

  it('reads an exhausted credit balance as its own switched-off state', () => {
    expect(
      readExtractionFailure({ error: EXTRACTION_OUT_OF_CREDIT_MESSAGE, outOfCredit: true }),
    ).toEqual({ status: 'out-of-credit', message: EXTRACTION_OUT_OF_CREDIT_MESSAGE })
  })

  it('reads a refused API key as its own switched-off state', () => {
    expect(
      readExtractionFailure({ error: EXTRACTION_KEY_REJECTED_MESSAGE, keyRejected: true }),
    ).toEqual({ status: 'key-rejected', message: EXTRACTION_KEY_REJECTED_MESSAGE })
  })

  it('keeps the model’s reason for a file that is not a receipt', () => {
    expect(
      readExtractionFailure({
        error: 'That file does not look like a receipt.',
        notReceipt: true,
        reason: 'It is a bank statement.',
      }),
    ).toEqual({
      status: 'not-receipt',
      message: 'That file does not look like a receipt.',
      reason: 'It is a bank statement.',
    })
  })

  it('leaves the reason null when the refusal gave none', () => {
    expect(readExtractionFailure({ notReceipt: true })).toEqual({
      status: 'not-receipt',
      message: NOT_RECEIPT_MESSAGE,
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
    expect(readExtractionFailure({ keyRejected: true })).toEqual({
      status: 'key-rejected',
      message: EXTRACTION_KEY_REJECTED_MESSAGE,
    })
  })
})
