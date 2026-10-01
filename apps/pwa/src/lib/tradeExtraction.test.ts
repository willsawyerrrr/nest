import { describe, expect, it } from 'vitest'
import {
  EXTRACTION_FAILED_MESSAGE,
  EXTRACTION_UNSUPPORTED_MESSAGE,
  readExtraction,
  readExtractionFailure,
  toReadResult,
} from './tradeExtraction'

const trade = {
  fields: {
    ticker: 'VAS',
    side: 'buy',
    traded_on: '2026-07-06',
    units: 10.5,
    price_per_unit_microdollars: 98_500_000,
    fee_cents: 9_50,
  },
  text: {},
  missing: [],
  unreadable: [],
}

describe('readExtraction', () => {
  it('reads each trade into form values', () => {
    expect(readExtraction({ model: 'm', trades: [trade, trade] })).toEqual([
      {
        values: {
          ticker: 'VAS',
          side: 'buy',
          traded_on: '2026-07-06',
          units: 10.5,
          price_per_unit_microdollars: 98_500_000,
          fee_cents: 9_50,
        },
        check: [],
      },
      expect.anything(),
    ])
  })

  it('keeps a partial-cent price exactly', () => {
    const [read] = readExtraction({
      model: 'm',
      trades: [{ ...trade, fields: { ...trade.fields, price_per_unit_microdollars: 33_083_072 } }],
    })!
    expect(read!.values.price_per_unit_microdollars).toBe(33_083_072)
  })

  it('leaves out a field that is null, ill-typed, or out of range', () => {
    const [read] = readExtraction({
      model: 'm',
      trades: [
        {
          fields: {
            ticker: null,
            side: 'swap',
            traded_on: 5,
            units: 0,
            price_per_unit_microdollars: -1,
            fee_cents: 'x',
          },
        },
      ],
    })!
    expect(read!.values).toEqual({})
  })

  it('names the fields to check, but not an absent brokerage fee', () => {
    const [read] = readExtraction({
      model: 'm',
      trades: [
        {
          fields: { ticker: 'VAS' },
          missing: ['traded_on', 'fee_cents', 'unknown'],
          unreadable: ['units', 'price_per_unit_microdollars', 'fee_cents'],
        },
      ],
    })!
    expect(read!.check).toEqual(['date', 'units', 'price per unit', 'brokerage fee'])
  })

  it('treats non-array field lists as nothing to check', () => {
    const [read] = readExtraction({
      model: 'm',
      trades: [{ fields: {}, missing: 'date', unreadable: null }],
    })!
    expect(read!.check).toEqual([])
  })

  it.each([
    null,
    'trades',
    { trades: [] },
    { model: 'm' },
    { model: 'm', trades: 'x' },
    { model: 'm', trades: [null] },
    { model: 'm', trades: [{}] },
  ])('rejects a body that is not an extraction: %j', (body) => {
    expect(readExtraction(body)).toBeNull()
  })
})

describe('readExtractionFailure', () => {
  it('reads the unsupported-type code as a document attached but not read', () => {
    expect(readExtractionFailure({ code: 'unsupported_type', error: 'x' })).toEqual({
      status: 'unsupported',
      message: EXTRACTION_UNSUPPORTED_MESSAGE,
    })
  })

  it("uses the function's own message when it came with a stable code", () => {
    expect(readExtractionFailure({ code: 'not_trade_document', error: 'Not a note.' })).toEqual({
      status: 'failed',
      message: 'Not a note.',
    })
  })

  it.each([
    null,
    'oops',
    { error: 'No household membership for this user' },
    { code: 'timeout' },
    { code: 5, error: 'x' },
  ])('falls back to the plain message otherwise: %j', (body) => {
    expect(readExtractionFailure(body)).toEqual({
      status: 'failed',
      message: EXTRACTION_FAILED_MESSAGE,
    })
  })
})

describe('reading that is off', () => {
  it.each(['not_configured', 'out_of_credit', 'key_rejected'])(
    'reads %s as reading being off, with the functions own copy',
    (code) => {
      expect(readExtractionFailure({ code, error: 'Off for now.' })).toEqual({
        status: 'off',
        message: 'Off for now.',
      })
    },
  )
})

describe('toReadResult', () => {
  it('hands the trades to the queue', () => {
    expect(toReadResult({ status: 'read', trades: [{ values: {}, check: [] }] })).toEqual({
      status: 'read',
      value: [{ values: {}, check: [] }],
    })
  })

  it('halts the queue when reading is off', () => {
    expect(toReadResult({ status: 'off', message: 'Off.' })).toEqual({
      status: 'halt',
      message: 'Off.',
    })
  })

  it('fails or sets aside one document without stopping the queue', () => {
    expect(toReadResult({ status: 'failed', message: 'Busy.' })).toEqual({
      status: 'failed',
      message: 'Busy.',
    })
    expect(toReadResult({ status: 'unsupported', message: 'No.' })).toEqual({
      status: 'unsupported',
      message: 'No.',
    })
  })
})
