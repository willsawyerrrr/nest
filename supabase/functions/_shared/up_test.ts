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

Deno.test('listTransactions puts filter[since] in the query', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(jsonResponse({ data: [], links: { next: null } }))
  }

  await new UpClient('token', 'https://up.test', fetchImpl).listTransactions(
    '2026-01-01T00:00:00+11:00',
  )

  const query = new URL(requestedUrl).searchParams
  assertEquals(query.get('filter[since]'), '2026-01-01T00:00:00+11:00')
  assertEquals(query.get('page[size]'), '100')
})

Deno.test('listTransactions omits filter[since] when no cursor is given', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(jsonResponse({ data: [], links: { next: null } }))
  }

  await new UpClient('token', 'https://up.test', fetchImpl).listTransactions()
  assertEquals(new URL(requestedUrl).searchParams.has('filter[since]'), false)
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
