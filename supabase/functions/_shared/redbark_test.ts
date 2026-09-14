import { assertEquals, assertRejects } from '@std/assert'
import { RedbarkApiError, RedbarkClient } from './redbark.ts'

/** Builds an OK JSON response like the Redbark API returns. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.test('every request sends the bearer key and Redbark-Version header', async () => {
  let authHeader: string | null = null
  let versionHeader: string | null = null
  const fetchImpl: typeof fetch = (_input, init) => {
    const requestHeaders = new Headers(init?.headers)
    authHeader = requestHeaders.get('Authorization')
    versionHeader = requestHeaders.get('Redbark-Version')
    return Promise.resolve(jsonResponse({ object: 'list', data: [], next_page_url: null }))
  }

  await new RedbarkClient('key-1', 'https://redbark.test', fetchImpl).listAccounts('conn-1')

  assertEquals(authHeader, 'Bearer key-1')
  assertEquals(versionHeader, '2026-10-01.wattle')
})

Deno.test('listAccounts paginates via next_page_url', async () => {
  const base = 'https://redbark.test'
  const calls: string[] = []
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push(url)
    if (calls.length === 1) {
      return Promise.resolve(
        jsonResponse({
          object: 'list',
          data: [{ id: 'a-1' }],
          next_page_url: `${base}/accounts?connection=conn-1&limit=100&page=cursor`,
        }),
      )
    }
    return Promise.resolve(
      jsonResponse({ object: 'list', data: [{ id: 'a-2' }], next_page_url: null }),
    )
  }

  const accounts = await new RedbarkClient('key', base, fetchImpl).listAccounts('conn-1')

  assertEquals(accounts.map((a) => a.id), ['a-1', 'a-2'])
  assertEquals(calls.length, 2)
  assertEquals(calls[0], `${base}/accounts?connection=conn-1&limit=100`)
  assertEquals(calls[1], `${base}/accounts?connection=conn-1&limit=100&page=cursor`)
})

Deno.test('getBalance fetches the account balance endpoint', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(
      jsonResponse({
        account: 'acc-1',
        current: { amount: 12345, currency: 'aud' },
        available: null,
        currency: 'aud',
        observed_at: '2026-09-14T00:00:00Z',
        freshness: 'live',
      }),
    )
  }

  const balance = await new RedbarkClient('key', 'https://redbark.test', fetchImpl).getBalance(
    'acc-1',
  )

  assertEquals(requestedUrl, 'https://redbark.test/accounts/acc-1/balance')
  assertEquals(balance.current.amount, 12345)
})

Deno.test('getConnection fetches the connection endpoint', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(
      jsonResponse({
        id: 'conn-1',
        provider: 'fiskil',
        category: 'banking',
        institution: { id: 'inst-1', name: 'Big Bank', logo: null },
        status: 'active',
        account_count: 2,
      }),
    )
  }

  const connection = await new RedbarkClient('key', 'https://redbark.test', fetchImpl)
    .getConnection('conn-1')

  assertEquals(requestedUrl, 'https://redbark.test/connections/conn-1')
  assertEquals(connection.institution.name, 'Big Bank')
})

Deno.test('deleteConnection sends a DELETE to the connection endpoint', async () => {
  let method = ''
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input, init) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    method = init?.method ?? 'GET'
    return Promise.resolve(new Response('{}', { status: 200 }))
  }

  await new RedbarkClient('key', 'https://redbark.test', fetchImpl).deleteConnection('conn-1')

  assertEquals(method, 'DELETE')
  assertEquals(requestedUrl, 'https://redbark.test/connections/conn-1')
})

Deno.test('createLinkSession POSTs the provider and return_url', async () => {
  let method = ''
  let body = ''
  let contentType: string | null = null
  const fetchImpl: typeof fetch = (_input, init) => {
    method = init?.method ?? 'GET'
    body = String(init?.body ?? '')
    contentType = new Headers(init?.headers).get('Content-Type')
    return Promise.resolve(
      jsonResponse({
        id: 'sess-1',
        status: 'pending',
        url: 'https://fiskil.test/consent',
        connection: null,
        failure_reason: null,
      }),
    )
  }

  const session = await new RedbarkClient('key', 'https://redbark.test', fetchImpl)
    .createLinkSession('https://nest.test/return')

  assertEquals(method, 'POST')
  assertEquals(contentType, 'application/json')
  assertEquals(JSON.parse(body), {
    provider: 'fiskil',
    return_url: 'https://nest.test/return',
  })
  assertEquals(session.id, 'sess-1')
  assertEquals(session.status, 'pending')
})

Deno.test('getLinkSession fetches the link session endpoint', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(
      jsonResponse({
        id: 'sess-1',
        status: 'completed',
        url: 'https://fiskil.test/consent',
        connection: 'conn-1',
        failure_reason: null,
      }),
    )
  }

  const session = await new RedbarkClient('key', 'https://redbark.test', fetchImpl).getLinkSession(
    'sess-1',
  )

  assertEquals(requestedUrl, 'https://redbark.test/link_sessions/sess-1')
  assertEquals(session.connection, 'conn-1')
})

Deno.test('a non-OK response throws RedbarkApiError with the status and body', async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('nope', { status: 401 }))

  await assertRejects(
    () => new RedbarkClient('key', 'https://redbark.test', fetchImpl).getConnection('conn-1'),
    RedbarkApiError,
    'Redbark API 401',
  )
})

Deno.test('a 429 response mentions Retry-After in the error message', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response('rate limited', { status: 429, headers: { 'Retry-After': '30' } }),
    )

  const error = await assertRejects(
    () => new RedbarkClient('key', 'https://redbark.test', fetchImpl).getConnection('conn-1'),
    RedbarkApiError,
  )
  assertEquals((error as RedbarkApiError).status, 429)
  assertEquals((error as RedbarkApiError).message.includes('Retry-After: 30'), true)
})

Deno.test('a non-OK response with a Redbark error envelope carries its code', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      jsonResponse(
        {
          error: {
            type: 'invalid_request',
            code: 'connection_not_found',
            message: 'No such connection',
          },
        },
        404,
      ),
    )

  const error = await assertRejects(
    () => new RedbarkClient('key', 'https://redbark.test', fetchImpl).deleteConnection('conn-1'),
    RedbarkApiError,
  )
  assertEquals((error as RedbarkApiError).code, 'connection_not_found')
})

Deno.test('a non-OK response with an unparseable body carries a null code', async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('boom', { status: 500 }))

  const error = await assertRejects(
    () => new RedbarkClient('key', 'https://redbark.test', fetchImpl).getConnection('conn-1'),
    RedbarkApiError,
  )
  assertEquals((error as RedbarkApiError).code, null)
})

Deno.test('ping hits /connections?limit=1 and is true on 200', async () => {
  let requestedUrl = ''
  let authHeader: string | null = null
  const fetchImpl: typeof fetch = (input, init) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    authHeader = new Headers(init?.headers).get('Authorization')
    return Promise.resolve(new Response('{}', { status: 200 }))
  }

  const ok = await new RedbarkClient('key-1', 'https://redbark.test', fetchImpl).ping()

  assertEquals(ok, true)
  assertEquals(requestedUrl, 'https://redbark.test/connections?limit=1')
  assertEquals(authHeader, 'Bearer key-1')
})

Deno.test('ping is false on a non-OK response', async () => {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response('unauthorized', { status: 401 }))
  assertEquals(await new RedbarkClient('key', 'https://redbark.test', fetchImpl).ping(), false)
})

Deno.test('ping is false when the request throws', async () => {
  const fetchImpl: typeof fetch = () => Promise.reject(new Error('network down'))
  assertEquals(await new RedbarkClient('key', 'https://redbark.test', fetchImpl).ping(), false)
})
