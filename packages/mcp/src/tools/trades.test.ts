import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import {
  addTrade,
  createTradesFromContent,
  createTradesFromDocument,
  deleteTrade,
  listHoldings,
  listTrades,
  updateTrade,
} from './trades.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'

const buy = {
  id: ID,
  household_id: 'h-1',
  member_id: 'm-self',
  ticker: 'VAS',
  side: 'buy',
  traded_on: '2026-01-10',
  units: '10.5',
  price_per_unit_microdollars: 100_000_000,
  fee_cents: 995,
  document_id: null,
}
const sell = {
  ...buy,
  id: 'other',
  side: 'sell',
  traded_on: '2026-03-01',
  units: '5',
  price_per_unit_microdollars: 110_000_000,
  fee_cents: 0,
}

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('listTrades', () => {
  it('lists newest first with member names and filters', async () => {
    const { ctx } = fakeContext({ tables: { trade: [buy, sell], members } })
    const all = await listTrades(ctx, {})
    expect(all.map((t) => t.id)).toEqual(['other', ID])
    expect(all[1]).toMatchObject({
      member: 'Alex',
      units: 10.5,
      price_per_unit_microdollars: 100_000_000,
    })
    expect(await listTrades(ctx, { ticker: 'XYZ' })).toEqual([])
    expect(await listTrades(ctx, { member: 'Sam' })).toEqual([])
  })
})

describe('listHoldings', () => {
  it('derives FIFO holdings valued at the last price', async () => {
    const { ctx } = fakeContext({ tables: { trade: [buy, sell], members } })
    const result = await listHoldings(ctx, {})
    expect(result.holdings).toHaveLength(1)
    expect(result.holdings[0]).toMatchObject({
      member: 'Alex',
      ticker: 'VAS',
      units: 5.5,
      last_price_microdollars: 110_000_000,
      value_cents: 605_00,
    })
    expect(result.unmatched_sales).toEqual([])
  })
})

describe('addTrade', () => {
  it('inserts into the household for the signed-in member', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const result = await addTrade(ctx, {
      ticker: 'VAS',
      side: 'buy',
      traded_on: '2026-01-10',
      units: 1.5,
      price_per_unit_microdollars: 33_083_072,
    })
    expect(state.inserts[0]).toEqual({
      table: 'trade',
      row: {
        household_id: 'h-1',
        member_id: 'm-self',
        ticker: 'VAS',
        side: 'buy',
        traded_on: '2026-01-10',
        units: 1.5,
        price_per_unit_microdollars: 33_083_072,
        fee_cents: 0,
      },
    })
    expect(result.id).toBe('new-id')
  })

  it('fails with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members }, insertError: true })
    const error = await failure(
      addTrade(ctx, {
        ticker: 'VAS',
        side: 'buy',
        traded_on: '2026-01-10',
        units: 1,
        price_per_unit_microdollars: 1,
      }),
    )
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('updateTrade', () => {
  it('changes only the fields given', async () => {
    const { ctx, state } = fakeContext({ tables: { trade: [buy] } })
    await updateTrade(ctx, { id: ID, units: 12 })
    expect(state.updates[0]?.row).toEqual({
      ticker: 'VAS',
      side: 'buy',
      traded_on: '2026-01-10',
      units: 12,
      price_per_unit_microdollars: 100_000_000,
      fee_cents: 995,
    })
  })

  it('reports an unknown id', async () => {
    const { ctx } = fakeContext()
    expect((await failure(updateTrade(ctx, { id: ID }))).code).toBe('not_found')
  })
})

describe('deleteTrade', () => {
  it('deletes by id', async () => {
    const { ctx, state } = fakeContext({ tables: { trade: [buy] } })
    expect(await deleteTrade(ctx, { id: ID })).toEqual({ id: ID, deleted: true })
    expect(state.deletes[0]?.table).toBe('trade')
  })

  it('reports an unknown id and a failed delete', async () => {
    expect((await failure(deleteTrade(fakeContext().ctx, { id: ID }))).code).toBe('not_found')
    const { ctx } = fakeContext({ tables: { trade: [buy] }, deleteError: true })
    expect((await failure(deleteTrade(ctx, { id: ID }))).code).toBe('delete_failed')
  })
})

const pdf = new Uint8Array([1, 2, 3])
const read = {
  model: 'm',
  trades: [
    {
      fields: {
        ticker: 'vas',
        side: 'buy',
        traded_on: '2026-01-10',
        units: 10.5,
        price_per_unit_microdollars: 100_000_000,
        fee_cents: 995,
      },
    },
    {
      fields: {
        ticker: 'NDQ',
        side: 'sell',
        traded_on: '2026-02-01',
        units: 2,
        price_per_unit_microdollars: 50_000_000,
      },
    },
  ],
}

describe('createTradesFromDocument', () => {
  it('stores the note, reads it, and writes document and trades together', async () => {
    const { ctx, state } = fakeContext({
      tables: { trade: [buy], members },
      files: { '/n/note.pdf': pdf },
      invoke: { data: read },
    })
    const result = await createTradesFromDocument(ctx, { file_path: '/n/note.pdf' })
    expect(state.uploadBuckets).toEqual(['receipts'])
    expect(state.uploads[0]?.path).toBe('h-1/uuid-1/uuid-2-note.pdf')
    expect(state.invocations[0]?.fn).toBe('trade-extract')
    const call = state.rpcCalls[0]!
    expect(call.fn).toBe('create_trades_with_document')
    expect(call.args).toMatchObject({ p_household_id: 'h-1', p_document_id: 'uuid-1' })
    expect((call.args.p_trades as unknown[])[1]).toMatchObject({
      ticker: 'NDQ',
      member_id: 'm-self',
      fee_cents: 0,
    })
    expect(result.trades.map((t) => t.ticker)).toEqual(['VAS', 'NDQ'])
    expect(result.possible_duplicates).toEqual([result.trades[0]!.id])
  })

  it('refuses a document that does not fully show a trade, and deletes the file', async () => {
    const { ctx, state } = fakeContext({
      tables: { members },
      files: { '/n/note.pdf': pdf },
      invoke: { data: { model: 'm', trades: [{ fields: { ticker: 'VAS' } }] } },
    })
    expect((await failure(createTradesFromDocument(ctx, { file_path: '/n/note.pdf' }))).code).toBe(
      'incomplete_details',
    )
    expect(state.rpcCalls).toEqual([])
    expect(state.removed).toHaveLength(1)
  })

  it('maps extraction failures to stable codes without upstream text', async () => {
    const cases: [string, string][] = [
      ['not_configured', 'extraction_unavailable'],
      ['no_trades', 'extraction_not_trade_document'],
      ['unsupported_type', 'extraction_unsupported_type'],
      ['rate_limited', 'extraction_failed'],
    ]
    for (const [code, expected] of cases) {
      const { ctx, state } = fakeContext({
        tables: { members },
        files: { '/n/note.pdf': pdf },
        invoke: { failure: { status: 422, body: { code, error: 'upstream detail' } } },
      })
      const error = await failure(createTradesFromDocument(ctx, { file_path: '/n/note.pdf' }))
      expect(error.code).toBe(expected)
      expect(error.message).not.toContain('upstream')
      expect(state.removed).toHaveLength(1)
    }
  })

  it('does not upload a type the model cannot read', async () => {
    const { ctx, state } = fakeContext({ tables: { members }, files: { '/n/note.csv': pdf } })
    expect((await failure(createTradesFromDocument(ctx, { file_path: '/n/note.csv' }))).code).toBe(
      'extraction_unsupported_type',
    )
    expect(state.uploads).toEqual([])
  })

  it('reports an unreadable file, a failed upload, and a failed save', async () => {
    const missing = await failure(
      createTradesFromDocument(fakeContext().ctx, { file_path: '/x.pdf' }),
    )
    expect(missing.code).toBe('file_unreadable')
    const up = fakeContext({ tables: { members }, files: { '/a.pdf': pdf }, uploadError: true })
    expect((await failure(createTradesFromDocument(up.ctx, { file_path: '/a.pdf' }))).code).toBe(
      'upload_failed',
    )
    const rpc = fakeContext({
      tables: { members },
      files: { '/a.pdf': pdf },
      invoke: { data: read },
      rpcError: true,
    })
    expect((await failure(createTradesFromDocument(rpc.ctx, { file_path: '/a.pdf' }))).code).toBe(
      'save_failed',
    )
    expect(rpc.state.removed).toHaveLength(1)
  })
})

describe('createTradesFromContent', () => {
  it('decodes base64 and rejects bad content', async () => {
    const { ctx, state } = fakeContext({ tables: { members }, invoke: { data: read } })
    await createTradesFromContent(ctx, { filename: 'note.pdf', content: 'AQID' })
    expect(state.uploads[0]?.bytes).toBe(3)
    const bad = await failure(
      createTradesFromContent(ctx, { filename: 'note.pdf', content: '***' }),
    )
    expect(bad.code).toBe('invalid_content')
  })
})
