import { assertEquals } from '@std/assert'
import { UpApiError } from '../_shared/up.ts'
import { type CategoriseDeps, runCategorise } from './categorise.ts'

const TX = '11111111-1111-4111-8111-111111111111'

/** Silences the server-side log lines a failure path writes. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await run()
  } finally {
    console.error = original
  }
}

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<CategoriseDeps> = {}): CategoriseDeps {
  return {
    resolveMember: () => Promise.resolve({ memberId: 'm-1' }),
    readTransaction: (id) =>
      Promise.resolve({ id, source: 'up', external_id: 'up-tx-1', is_categorizable: true }),
    readCategory: (id) =>
      Promise.resolve(id === 'personal' ? { id, parent_id: null } : { id, parent_id: 'personal' }),
    tokenFor: () => Promise.resolve('up:token'),
    categorise: () => Promise.resolve(),
    recordCategory: () => Promise.resolve(true),
    ...overrides,
  }
}

Deno.test('runCategorise writes the category to Up and then the local row', async () => {
  const calls: unknown[][] = []
  const result = await runCategorise(
    { transaction_id: TX, category_id: 'gifts-and-charity' },
    deps({
      categorise: (...args) => {
        calls.push(['up', ...args])
        return Promise.resolve()
      },
      recordCategory: (...args) => {
        calls.push(['local', ...args])
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(result, {
    status: 200,
    body: { transaction_id: TX, category_id: 'gifts-and-charity', parent_category_id: 'personal' },
  })
  assertEquals(calls, [
    ['up', 'up:token', 'up-tx-1', 'gifts-and-charity'],
    ['local', TX, 'gifts-and-charity'],
  ])
})

Deno.test('runCategorise clears the category with null, skipping the category lookup', async () => {
  let looked = false
  const result = await runCategorise(
    { transaction_id: TX, category_id: null },
    deps({
      readCategory: () => {
        looked = true
        return Promise.resolve(null)
      },
    }),
  )
  assertEquals(result.status, 200)
  assertEquals(result.body.category_id, null)
  assertEquals(looked, false)
})

Deno.test('runCategorise refuses a malformed body before resolving anyone', async () => {
  let resolved = false
  const bodies = [
    null,
    {},
    { transaction_id: 'not-a-uuid', category_id: null },
    { transaction_id: TX },
    { transaction_id: TX, category_id: 7 },
    { transaction_id: TX, category_id: '  ' },
  ]
  for (const body of bodies) {
    const result = await runCategorise(
      body,
      deps({
        resolveMember: () => {
          resolved = true
          return Promise.resolve({ memberId: 'm-1' })
        },
      }),
    )
    assertEquals(result.status, 400)
    assertEquals(result.body.code, 'invalid_request')
  }
  assertEquals(resolved, false)
})

Deno.test('runCategorise passes a caller resolution error through', async () => {
  const result = await runCategorise(
    { transaction_id: TX, category_id: null },
    deps({
      resolveMember: () =>
        Promise.resolve({ error: { status: 401, message: 'Invalid authorization' } }),
    }),
  )
  assertEquals(result, { status: 401, body: { error: 'Invalid authorization' } })
})

Deno.test('runCategorise answers transaction_not_found for a row RLS hides', async () => {
  const result = await runCategorise(
    { transaction_id: TX, category_id: null },
    deps({ readTransaction: () => Promise.resolve(null) }),
  )
  assertEquals(result.status, 404)
  assertEquals(result.body.code, 'transaction_not_found')
})

Deno.test('runCategorise refuses a manual row', async () => {
  const result = await runCategorise(
    { transaction_id: TX, category_id: null },
    deps({
      readTransaction: (id) =>
        Promise.resolve({ id, source: 'manual', external_id: null, is_categorizable: null }),
    }),
  )
  assertEquals(result.body.code, 'not_up_transaction')
})

Deno.test('runCategorise refuses a row Up marks uncategorisable, never calling Up', async () => {
  let called = false
  const result = await runCategorise(
    { transaction_id: TX, category_id: null },
    deps({
      readTransaction: (id) =>
        Promise.resolve({ id, source: 'up', external_id: 'up-tx-1', is_categorizable: false }),
      categorise: () => {
        called = true
        return Promise.resolve()
      },
    }),
  )
  assertEquals(result.body.code, 'not_categorisable')
  assertEquals(called, false)
})

Deno.test('runCategorise refuses an unknown category and a parent category', async () => {
  const unknown = await runCategorise(
    { transaction_id: TX, category_id: 'made-up' },
    deps({ readCategory: () => Promise.resolve(null) }),
  )
  assertEquals(unknown.body.code, 'unknown_category')

  const parent = await runCategorise({ transaction_id: TX, category_id: 'personal' }, deps())
  assertEquals(parent.body.code, 'parent_category')
})

Deno.test('runCategorise points a member without a token at Connections', async () => {
  const result = await runCategorise(
    { transaction_id: TX, category_id: null },
    deps({ tokenFor: () => Promise.resolve(null) }),
  )
  assertEquals(result.status, 409)
  assertEquals(result.body.code, 'up_not_connected')
})

Deno.test('runCategorise maps an Up failure to a fixed code and skips the local write', async () => {
  let recorded = false
  const result = await quietly(() =>
    runCategorise(
      { transaction_id: TX, category_id: null },
      deps({
        categorise: () => Promise.reject(new UpApiError(429, '/x', 'secret detail')),
        recordCategory: () => {
          recorded = true
          return Promise.resolve(true)
        },
      }),
    )
  )
  assertEquals(result.status, 429)
  assertEquals(result.body.code, 'up_rate_limited')
  assertEquals(JSON.stringify(result).includes('secret detail'), false)
  assertEquals(recorded, false)
})

Deno.test('runCategorise reports save_failed when the local write fails after Up took it', async () => {
  const result = await runCategorise(
    { transaction_id: TX, category_id: null },
    deps({ recordCategory: () => Promise.resolve(false) }),
  )
  assertEquals(result.status, 500)
  assertEquals(result.body.code, 'save_failed')
})

Deno.test('runCategorise answers server_error when a lookup throws', async () => {
  const result = await quietly(() =>
    runCategorise(
      { transaction_id: TX, category_id: null },
      deps({ readTransaction: () => Promise.reject(new Error('db down')) }),
    )
  )
  assertEquals(result.status, 500)
  assertEquals(result.body.code, 'server_error')
})
