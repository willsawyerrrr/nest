import { describe, expect, it } from 'vitest'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_KEY_REJECTED_MESSAGE,
  EXTRACTION_OUT_OF_CREDIT_MESSAGE,
  EXTRACTION_UNCONFIGURED_MESSAGE,
  matchInflowByLabel,
  NOT_PAYSLIP_MESSAGE,
  readExtraction,
  readExtractionFailure,
} from './payslipExtraction'

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

  it('keeps the fields and lines the form pre-fills from, and nothing else', () => {
    // The reply also carries the literal text read for each field and which
    // fields were missing or unreadable — the auditable record of the read — none
    // of which the form pre-fills from or shows back, so none of it is carried in.
    expect(readExtraction(body())).toEqual({
      model: 'claude-haiku-4-5-20251001',
      fields: { period_start: '2026-07-06', gross_cents: 4_120_50 },
      lines: { earnings: [], tax: [] },
    })
  })

  it('leaves a negative amount blank rather than pre-filling it', () => {
    // A slip printing tax withheld as a deduction parses to a negative, which
    // the column's own `>= 0` check would reject at save. The sign is not guessed
    // at: the field is left for the member to type off the document.
    const extraction = readExtraction(
      body({
        fields: { tax_withheld_cents: -1_048_00, gross_cents: 4_120_50 },
        text: { tax_withheld: '(1,048.00)' },
        missing: [],
      }),
    )

    expect(extraction!.fields.tax_withheld_cents).toBeUndefined()
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
      lines: { earnings: [], tax: [] },
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
    ).toEqual({
      model: 'm',
      fields: {},
      lines: { earnings: [], tax: [] },
    })
  })

  it('keeps the slip’s itemisation, each line as a row to fill in', () => {
    const extraction = readExtraction(
      body({
        lines: {
          earnings: [
            { label: 'Ordinary Hours', amount: '$4,000.00', amount_cents: 4_000_00 },
            { label: 'Annual Leave', amount: '$1,000.00', amount_cents: 1_000_00 },
            { label: 'On-call (T1)', amount: '$495.50', amount_cents: 495_50 },
          ],
          tax: [
            { label: 'PAYG', amount: '$1,416.00', amount_cents: 1_416_00, component: 'payg' },
            {
              label: 'STSL Component',
              amount: '$434.00',
              amount_cents: 434_00,
              component: 'stsl',
            },
          ],
        },
      }),
    )

    expect(extraction!.lines.earnings).toEqual([
      { label: 'Ordinary Hours', amount_cents: 4_000_00 },
      { label: 'Annual Leave', amount_cents: 1_000_00 },
      { label: 'On-call (T1)', amount_cents: 495_50 },
    ])
    expect(extraction!.lines.tax).toEqual([
      { label: 'PAYG', amount_cents: 1_416_00, component: 'payg' },
      { label: 'STSL Component', amount_cents: 434_00, component: 'stsl' },
    ])
  })

  it('keeps a negative line amount, where a negative total is left blank', () => {
    // `payslip_line.amount_cents` carries no `>= 0` check, deliberately: a line
    // reversing an overpayment is a figure to fill in rather than one to drop.
    const extraction = readExtraction(
      body({
        fields: { tax_withheld_cents: -1_048_00 },
        lines: {
          earnings: [{ label: 'Overpayment recovery', amount: '($120.00)', amount_cents: -120_00 }],
          tax: [],
        },
        missing: [],
      }),
    )

    expect(extraction!.lines.earnings[0]!.amount_cents).toBe(-120_00)
    expect(extraction!.fields.tax_withheld_cents).toBeUndefined()
  })

  it('leaves a tax component it does not recognise unnamed rather than PAYG', () => {
    const extraction = readExtraction(
      body({
        lines: {
          earnings: [],
          tax: [
            { label: 'Withholding', amount: '$1,850.00', amount_cents: 185_000, component: null },
            { label: 'Adjustment', amount: '$12.00', amount_cents: 12_00, component: 'other' },
            { label: 'Extra tax', amount: '$50.00', amount_cents: 50_00 },
            // No label, so no row to show: dropped as an earnings line would be.
            { amount: '$1.00', amount_cents: 100, component: 'payg' },
          ],
        },
      }),
    )

    // The two pay different parts of the liability, so an unnamed one is the
    // member's to pick, never defaulted to the commoner of the two.
    expect(extraction!.lines.tax.map((line) => line.label)).toEqual([
      'Withholding',
      'Adjustment',
      'Extra tax',
    ])
    expect(extraction!.lines.tax.map((line) => line.component)).toEqual([null, null, null])
  })

  it('drops anything that is not a line the form could show as a row', () => {
    const extraction = readExtraction(
      body({
        lines: {
          earnings: [
            { label: 'Ordinary Hours', amount: '$4,000.00', amount_cents: 4_000_00 },
            // No usable label: nothing to show as a row.
            { amount: '$1.00', amount_cents: 100 },
            { label: '  ', amount: '$1.00', amount_cents: 100 },
            // Cents are integers; anything else is not a figure to fill in.
            { label: 'Bonus', amount: '$1.005', amount_cents: 100.5 },
            { label: 'Overtime', amount: 12, amount_cents: '500' },
            'Ordinary Hours',
            null,
          ],
          // Not an array: the section reads as unitemised rather than as a failure.
          tax: { label: 'PAYG', amount_cents: 185_000 },
        },
      }),
    )

    expect(extraction!.lines.earnings).toEqual([
      { label: 'Ordinary Hours', amount_cents: 4_000_00 },
      // The label survives an amount that could not be converted; the form leaves
      // such a line out of the itemisation rather than filling in half a row.
      { label: 'Bonus', amount_cents: null },
      { label: 'Overtime', amount_cents: null },
    ])
    expect(extraction!.lines.tax).toEqual([])
  })

  it('reads a reply whose lines are not an object as an unitemised slip', () => {
    expect(readExtraction(body({ lines: 'earnings' }))!.lines).toEqual({ earnings: [], tax: [] })
  })
})

describe('matchInflowByLabel', () => {
  const options = [
    { value: 'i1', label: 'Day job' },
    { value: 'i4', label: 'On-call (T1)' },
    { value: 'i5', label: 'On-call (T2)' },
  ]

  it('matches a printed label naming exactly one inflow, whatever its case or spacing', () => {
    expect(matchInflowByLabel('On-call (T1)', options)).toBe('i4')
    expect(matchInflowByLabel('  day JOB  ', options)).toBe('i1')
    expect(matchInflowByLabel('On-call\n  (T1)', options)).toBe('i4')
  })

  it('leaves a label no inflow answers to unmatched', () => {
    expect(matchInflowByLabel('Ordinary Hours', options)).toBeNull()
    expect(matchInflowByLabel('   ', options)).toBeNull()
    expect(matchInflowByLabel('Day job', [])).toBeNull()
  })

  it('never matches on part of a name, however close', () => {
    // A line attributed to the wrong inflow moves the measured variance of both
    // without saying so, so only the whole label against the whole name counts.
    expect(matchInflowByLabel('On-call', options)).toBeNull()
    expect(matchInflowByLabel('On-call (T1) allowance', options)).toBeNull()
    expect(matchInflowByLabel('Day', options)).toBeNull()
  })

  it('leaves a label two inflows answer to unmatched', () => {
    expect(
      matchInflowByLabel('On-call', [
        { value: 'i4', label: 'On-call' },
        { value: 'i5', label: 'ON-CALL' },
      ]),
    ).toBeNull()
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

  it('reads a refused API key as its own switched-off state', () => {
    expect(
      readExtractionFailure({
        error: EXTRACTION_KEY_REJECTED_MESSAGE,
        keyRejected: true,
      }),
    ).toEqual({ status: 'key-rejected', message: EXTRACTION_KEY_REJECTED_MESSAGE })
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
    expect(readExtractionFailure({ keyRejected: true })).toEqual({
      status: 'key-rejected',
      message: EXTRACTION_KEY_REJECTED_MESSAGE,
    })
  })

  it('keeps the three switched-off states apart, since each fix differs', () => {
    // All three mean reading is off, but one is a Vault secret to set, one an
    // account to top up, and one a key to rotate, so none is ever read as another.
    expect(readExtractionFailure({ configured: false }).status).toBe('not-configured')
    expect(readExtractionFailure({ outOfCredit: true }).status).toBe('out-of-credit')
    expect(readExtractionFailure({ keyRejected: true }).status).toBe('key-rejected')
    expect(
      new Set([
        EXTRACTION_UNCONFIGURED_MESSAGE,
        EXTRACTION_OUT_OF_CREDIT_MESSAGE,
        EXTRACTION_KEY_REJECTED_MESSAGE,
      ]).size,
    ).toBe(3)
  })
})
