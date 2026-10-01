import { describe, expect, it } from 'vitest'
import { EXTRACTION_FAILED_MESSAGE, readExtraction, readExtractionFailure } from './tradeExtraction'

const trade = {
  fields: {
    ticker: 'VAS',
    side: 'buy',
    traded_on: '2026-07-06',
    units: 10.5,
    price_per_unit_cents: 98_50,
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
          price_per_unit_cents: 98_50,
          fee_cents: 9_50,
        },
        check: [],
      },
      expect.anything(),
    ])
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
            price_per_unit_cents: -1,
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
          unreadable: ['units', 'price_per_unit_cents', 'fee_cents'],
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
