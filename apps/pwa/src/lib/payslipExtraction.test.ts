import { describe, expect, it } from 'vitest'
import {
  EXTRACTED_AMOUNT_FIELDS,
  EXTRACTED_DATE_FIELDS,
  EXTRACTED_FIELD_LABELS,
  extractedTextKey,
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  NOT_PAYSLIP_MESSAGE,
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

  it('states each specific outcome even when its own message is missing', () => {
    expect(readExtractionFailure({ configured: false })).toEqual({
      status: 'not-configured',
      message: EXTRACTION_UNCONFIGURED_MESSAGE,
    })
  })
})
