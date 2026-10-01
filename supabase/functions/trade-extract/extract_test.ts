import { assertEquals } from '@std/assert'
import type { RawTradeDocument } from './fields.ts'
import {
  type ExtractDeps,
  householdSegment,
  normaliseFinancialYear,
  normalisePath,
  runExtract,
} from './extract.ts'
import { MAX_IMAGE_BYTES, type ModelResult, TRADE_MODEL } from './model.ts'

const HOUSEHOLD = 'hh-1'
const PATH = `${HOUSEHOLD}/draft-1/note.pdf`
const FINANCIAL_YEAR = 2026

/** A document with two trades, overridable per test. */
function document(overrides: Partial<RawTradeDocument> = {}): RawTradeDocument {
  const trade = {
    ticker: 'VAS',
    side: 'buy',
    trade_date: '2026-07-06',
    units: '10.5',
    price_per_unit: '98.50',
    brokerage_fee: '9.50',
  }
  return {
    is_trade_document: true,
    trades: [trade, { ...trade, ticker: 'VGS', side: 'sell' }],
    ...overrides,
  }
}

/**
 * Default happy-path deps, overridable per test. `calls` records every dependency
 * the flow reaches, so a test can assert both the ordering and that nothing was
 * touched after a failure.
 */
function deps(overrides: Partial<ExtractDeps> = {}): ExtractDeps & { calls: string[] } {
  const calls: string[] = []
  const wrap = <T extends (...args: never[]) => unknown>(
    name: string,
    fallback: T,
  ): T => (((...args: never[]) => {
    calls.push(name)
    return (overrides[name as keyof ExtractDeps] as T | undefined ?? fallback)(...args)
  }) as T)

  return {
    calls,
    resolveHousehold: wrap('resolveHousehold', () => Promise.resolve({ householdId: HOUSEHOLD })),
    apiKey: wrap('apiKey', () => Promise.resolve('sk-ant-test')),
    downloadObject: wrap(
      'downloadObject',
      () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' }),
    ),
    extract: wrap(
      'extract',
      () => Promise.resolve({ ok: true as const, document: document() } as ModelResult),
    ),
  }
}

/** The body's stable code. */
function code(body: unknown): unknown {
  return (body as { code?: unknown }).code
}

Deno.test('normalisePath accepts a household-prefixed object path only', () => {
  assertEquals(normalisePath(`  ${PATH}  `), PATH)
  assertEquals(normalisePath(undefined), '')
  assertEquals(normalisePath('note.pdf'), '')
  assertEquals(normalisePath(`/${PATH}`), '')
  assertEquals(normalisePath('hh-1/../hh-2/note.pdf'), '')
  assertEquals(normalisePath('hh-1//note.pdf'), '')
})

Deno.test('normaliseFinancialYear accepts whole numbers only', () => {
  assertEquals(normaliseFinancialYear(2026), 2026)
  assertEquals(normaliseFinancialYear('2026'), null)
  assertEquals(normaliseFinancialYear(2026.5), null)
  assertEquals(normaliseFinancialYear(undefined), null)
})

Deno.test('householdSegment is the first path segment', () => {
  assertEquals(householdSegment(PATH), HOUSEHOLD)
})

Deno.test('a document yields one extraction per trade', async () => {
  const d = deps()
  const result = await runExtract(PATH, FINANCIAL_YEAR, d)

  assertEquals(result.status, 200)
  const body = result.body as { model: string; trades: { fields: Record<string, unknown> }[] }
  assertEquals(body.model, TRADE_MODEL)
  assertEquals(body.trades.map((trade) => trade.fields.ticker), ['VAS', 'VGS'])
  assertEquals(body.trades[1].fields.side, 'sell')
  assertEquals(d.calls, ['resolveHousehold', 'apiKey', 'downloadObject', 'extract'])
})

Deno.test('the model is given the file, key, and financial year', async () => {
  let seen: unknown[] = []
  const d = deps({
    extract: (...args) => {
      seen = args
      return Promise.resolve({ ok: true, document: document() })
    },
  })
  await runExtract(PATH, FINANCIAL_YEAR, d)

  assertEquals(seen[1], 'sk-ant-test')
  assertEquals(seen[2], FINANCIAL_YEAR)
})

Deno.test('a missing path or financial year is rejected before anything is read', async () => {
  const d = deps()

  const noPath = await runExtract(undefined, FINANCIAL_YEAR, d)
  const noYear = await runExtract(PATH, undefined, d)

  assertEquals([noPath.status, code(noPath.body)], [400, 'path_required'])
  assertEquals([noYear.status, code(noYear.body)], [400, 'financial_year_required'])
  assertEquals(d.calls, [])
})

Deno.test('a household error is returned as is', async () => {
  const d = deps({
    resolveHousehold: () => Promise.resolve({ error: { status: 401, message: 'Unauthorized' } }),
  })
  const result = await runExtract(PATH, FINANCIAL_YEAR, d)

  assertEquals(result, { status: 401, body: { error: 'Unauthorized' } })
  assertEquals(d.calls, ['resolveHousehold'])
})

Deno.test('a caller with no household is not found', async () => {
  const d = deps({ resolveHousehold: () => Promise.resolve({}) })
  const result = await runExtract(PATH, FINANCIAL_YEAR, d)

  assertEquals([result.status, code(result.body)], [404, 'household_not_found'])
})

Deno.test("another household's file is forbidden before the key or file is touched", async () => {
  const d = deps()
  const result = await runExtract('hh-2/draft-1/note.pdf', FINANCIAL_YEAR, d)

  assertEquals([result.status, code(result.body)], [403, 'wrong_household'])
  assertEquals(d.calls, ['resolveHousehold'])
})

Deno.test('an unset key degrades to a 503 before the file is read', async () => {
  const d = deps({ apiKey: () => Promise.resolve(null) })
  const result = await runExtract(PATH, FINANCIAL_YEAR, d)

  assertEquals([result.status, code(result.body)], [503, 'not_configured'])
  assertEquals(d.calls, ['resolveHousehold', 'apiKey'])
})

Deno.test('a file that is not in the bucket is not found', async () => {
  const d = deps({ downloadObject: () => Promise.resolve(null) })
  const result = await runExtract(PATH, FINANCIAL_YEAR, d)

  assertEquals([result.status, code(result.body)], [404, 'file_not_found'])
})

Deno.test('an empty file is rejected', async () => {
  const d = deps({
    downloadObject: () =>
      Promise.resolve({ bytes: new Uint8Array(), contentType: 'application/pdf' }),
  })
  const result = await runExtract(PATH, FINANCIAL_YEAR, d)

  assertEquals([result.status, code(result.body)], [400, 'file_empty'])
})

Deno.test('a file type the model cannot read is rejected without calling it', async () => {
  const d = deps({
    downloadObject: () =>
      Promise.resolve({ bytes: new Uint8Array([1]), contentType: 'application/zip' }),
  })
  const result = await runExtract('hh-1/draft-1/note.zip', FINANCIAL_YEAR, d)

  assertEquals([result.status, code(result.body)], [415, 'unsupported_type'])
  assertEquals(d.calls.includes('extract'), false)
})

Deno.test('an oversized file is rejected with its size', async () => {
  const d = deps({
    downloadObject: () =>
      Promise.resolve({
        bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
        contentType: 'image/png',
      }),
  })
  const result = await runExtract('hh-1/draft-1/note.png', FINANCIAL_YEAR, d)

  assertEquals([result.status, code(result.body)], [413, 'file_too_large'])
  assertEquals(
    (result.body as { error: string }).error,
    'That file is too large to read (5.0 MB; the limit is 5.0 MB).',
  )
})

Deno.test('a document that is not a trade document is rejected with fixed copy', async () => {
  const result = await runExtract(
    PATH,
    FINANCIAL_YEAR,
    deps({
      extract: () =>
        Promise.resolve({ ok: true, document: document({ is_trade_document: false, trades: [] }) }),
    }),
  )

  assertEquals([result.status, code(result.body)], [422, 'not_trade_document'])
  assertEquals(Object.keys(result.body as object).sort(), ['code', 'error'])
})

Deno.test('a trade document with no trades is its own outcome', async () => {
  const result = await runExtract(
    PATH,
    FINANCIAL_YEAR,
    deps({ extract: () => Promise.resolve({ ok: true, document: document({ trades: [] }) }) }),
  )

  assertEquals([result.status, code(result.body)], [422, 'no_trades'])
})

/** What a model failure maps to. */
async function failure(
  failed: Extract<ModelResult, { ok: false }>,
): Promise<[number, unknown]> {
  const result = await runExtract(
    PATH,
    FINANCIAL_YEAR,
    deps({ extract: () => Promise.resolve(failed) }),
  )
  return [result.status, code(result.body)]
}

Deno.test('model failures map to a status and a stable code', async () => {
  const message = 'upstream secret detail'
  assertEquals(await failure({ ok: false, failure: 'no_credit', message }), [503, 'out_of_credit'])
  assertEquals(await failure({ ok: false, failure: 'key_rejected', message }), [
    503,
    'key_rejected',
  ])
  assertEquals(await failure({ ok: false, failure: 'timeout', message }), [504, 'timeout'])
  assertEquals(await failure({ ok: false, failure: 'malformed', message }), [502, 'unreadable'])
  assertEquals(await failure({ ok: false, failure: 'refused', message }), [422, 'refused'])
  assertEquals(await failure({ ok: false, failure: 'api_error', message, status: 429 }), [
    429,
    'rate_limited',
  ])
})

Deno.test('a transient upstream failure invites a retry; a rejected request does not', async () => {
  const message = 'x'
  assertEquals(await failure({ ok: false, failure: 'api_error', message }), [502, 'unavailable'])
  assertEquals(await failure({ ok: false, failure: 'api_error', message, status: 503 }), [
    502,
    'unavailable',
  ])
  assertEquals(await failure({ ok: false, failure: 'api_error', message, status: 400 }), [
    502,
    'unreadable',
  ])
})

Deno.test('no failure body carries the upstream message', async () => {
  const result = await runExtract(
    PATH,
    FINANCIAL_YEAR,
    deps({
      extract: () =>
        Promise.resolve({
          ok: false,
          failure: 'api_error',
          message: 'upstream secret detail',
          status: 500,
        }),
    }),
  )

  assertEquals(JSON.stringify(result.body).includes('secret'), false)
})
