import { assertEquals, assertRejects } from '@std/assert'
import { UpClient } from './up.ts'

/** Builds an OK JSON response like the Up API returns. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.test('paginate walks links.next across pages', async () => {
  const base = 'https://up.test'
  const calls: string[] = []
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
    calls.push(url)
    if (url.includes('page[size]=100') && !url.includes('after=')) {
      return Promise.resolve(
        jsonResponse({
          data: [{ id: 'a-1', attributes: {}, relationships: {} }],
          links: { next: `${base}/accounts?after=cursor` },
        }),
      )
    }
    return Promise.resolve(
      jsonResponse({
        data: [{ id: 'a-2', attributes: {}, relationships: {} }],
        links: { next: null },
      }),
    )
  }

  const client = new UpClient('token', base, fetchImpl)
  const accounts = await client.listAccounts()

  assertEquals(accounts.map((a) => a.id), ['a-1', 'a-2'])
  assertEquals(calls.length, 2)
  assertEquals(calls[1], `${base}/accounts?after=cursor`)
})

Deno.test('listAccounts sends the bearer token', async () => {
  let authHeader: string | null = null
  const fetchImpl: typeof fetch = (_input, init) => {
    authHeader = new Headers(init?.headers).get('Authorization')
    return Promise.resolve(jsonResponse({ data: [], links: { next: null } }))
  }

  await new UpClient('secret-token', 'https://up.test', fetchImpl).listAccounts()
  assertEquals(authHeader, 'Bearer secret-token')
})

Deno.test('listTransactions filters by category and since, one page of 100', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(jsonResponse({ data: [], links: { next: null } }))
  }

  await new UpClient('token', 'https://up.test', fetchImpl).listTransactions({
    since: new Date('2026-01-01T00:00:00+11:00'),
    category: 'gifts-and-charity',
  })

  const query = new URL(requestedUrl).searchParams
  assertEquals(query.get('filter[since]'), '2025-12-31T13:00:00.000Z')
  assertEquals(query.get('filter[category]'), 'gifts-and-charity')
  assertEquals(query.get('page[size]'), '100')
})

Deno.test('listTransactions omits both filters when no options are given', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(jsonResponse({ data: [], links: { next: null } }))
  }

  await new UpClient('token', 'https://up.test', fetchImpl).listTransactions()
  const query = new URL(requestedUrl).searchParams
  assertEquals(query.has('filter[since]'), false)
  assertEquals(query.has('filter[category]'), false)
})

Deno.test('listTransactions walks links.next to the end', async () => {
  const base = 'https://up.test'
  const calls: string[] = []
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push(url)
    return Promise.resolve(
      jsonResponse(
        calls.length === 1
          ? {
            data: [{ id: 'tx-1' }],
            links: { next: `${base}/transactions?after=cursor` },
          }
          : { data: [{ id: 'tx-2' }], links: { next: null } },
      ),
    )
  }

  const transactions = await new UpClient('token', base, fetchImpl).listTransactions({
    category: 'gifts-and-charity',
  })

  assertEquals(transactions.map((tx) => tx.id), ['tx-1', 'tx-2'])
  assertEquals(calls[1], `${base}/transactions?after=cursor`)
})

Deno.test('a non-OK response throws', async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('nope', { status: 401 }))

  await assertRejects(
    () => new UpClient('token', 'https://up.test', fetchImpl).listAccounts(),
    Error,
    'Up API 401',
  )
})

Deno.test('ping hits /util/ping with the bearer token and is true on 200', async () => {
  let requestedUrl = ''
  let authHeader: string | null = null
  const fetchImpl: typeof fetch = (input, init) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    authHeader = new Headers(init?.headers).get('Authorization')
    return Promise.resolve(new Response('{}', { status: 200 }))
  }

  const ok = await new UpClient('secret-token', 'https://up.test', fetchImpl).ping()

  assertEquals(ok, true)
  assertEquals(requestedUrl, 'https://up.test/util/ping')
  assertEquals(authHeader, 'Bearer secret-token')
})

Deno.test('ping is false on a non-OK response', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response('unauthorized', { status: 401 }))
  assertEquals(await new UpClient('token', 'https://up.test', fetchImpl).ping(), false)
})

Deno.test('ping is false when the request throws', async () => {
  const fetchImpl: typeof fetch = () => Promise.reject(new Error('network down'))
  assertEquals(await new UpClient('token', 'https://up.test', fetchImpl).ping(), false)
})
