import { assertEquals, assertRejects } from '@std/assert'
import { isUpAuthError, rateLimitWaitMs, UpApiError, UpClient } from './up.ts'

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

Deno.test('a non-OK response throws an UpApiError carrying the status', async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('nope', { status: 403 }))

  const error = await assertRejects(
    () => new UpClient('token', 'https://up.test', fetchImpl).listAccounts(),
    UpApiError,
  )
  assertEquals(error.status, 403)
})

Deno.test('isUpAuthError is true for 401 and 403 UpApiErrors', () => {
  assertEquals(isUpAuthError(new UpApiError(401, '/accounts', '')), true)
  assertEquals(isUpAuthError(new UpApiError(403, '/accounts', '')), true)
})

Deno.test('isUpAuthError is false for a non-auth UpApiError, a plain Error, or anything else', () => {
  assertEquals(isUpAuthError(new UpApiError(500, '/accounts', '')), false)
  assertEquals(isUpAuthError(new Error('network down')), false)
  assertEquals(isUpAuthError('nope'), false)
  assertEquals(isUpAuthError(null), false)
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

/** Resolves immediately, recording each wait the client asked for. */
function recordSleeps(waits: number[]): (ms: number) => Promise<void> {
  return (ms) => {
    waits.push(ms)
    return Promise.resolve()
  }
}

Deno.test('getTransaction reads one transaction by id', async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(jsonResponse({ data: { id: 'tx-1' } }))
  }

  const tx = await new UpClient('token', 'https://up.test', fetchImpl).getTransaction('tx-1')
  assertEquals(tx?.id, 'tx-1')
  assertEquals(requestedUrl, 'https://up.test/transactions/tx-1')
})

Deno.test('getTransaction is null for a transaction Up no longer has', async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('gone', { status: 404 }))
  assertEquals(
    await new UpClient('token', 'https://up.test', fetchImpl).getTransaction('tx-1'),
    null,
  )
})

Deno.test('getTransaction throws on any other non-OK response', async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('nope', { status: 500 }))
  await assertRejects(
    () => new UpClient('token', 'https://up.test', fetchImpl).getTransaction('tx-1'),
    UpApiError,
  )
})

Deno.test("listAccountTransactions lists one account's transactions since an instant", async () => {
  let requestedUrl = ''
  const fetchImpl: typeof fetch = (input) => {
    requestedUrl = typeof input === 'string' ? input : (input as Request).url
    return Promise.resolve(jsonResponse({ data: [{ id: 'tx-1' }], links: { next: null } }))
  }

  const transactions = await new UpClient('token', 'https://up.test', fetchImpl)
    .listAccountTransactions('acc-1', new Date('2025-06-30T14:00:00Z'))

  const url = new URL(requestedUrl)
  assertEquals(url.pathname, '/accounts/acc-1/transactions')
  assertEquals(url.searchParams.get('filter[since]'), '2025-06-30T14:00:00.000Z')
  assertEquals(url.searchParams.get('page[size]'), '100')
  assertEquals(transactions.map((tx) => tx.id), ['tx-1'])
})

Deno.test('a 429 is retried after the Retry-After wait', async () => {
  const waits: number[] = []
  let calls = 0
  const fetchImpl: typeof fetch = () => {
    calls += 1
    return Promise.resolve(
      calls === 1
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } })
        : jsonResponse({ data: [], links: { next: null } }),
    )
  }

  await new UpClient('token', 'https://up.test', fetchImpl, recordSleeps(waits)).listAccounts()
  assertEquals(calls, 2)
  assertEquals(waits, [2000])
})

Deno.test('a 429 that persists throws once the retries are spent', async () => {
  const waits: number[] = []
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('slow down', { status: 429 }))

  const error = await assertRejects(
    () => new UpClient('token', 'https://up.test', fetchImpl, recordSleeps(waits)).listAccounts(),
    UpApiError,
  )
  assertEquals(error.status, 429)
  assertEquals(waits, [1000, 2000, 4000])
})

Deno.test('rateLimitWaitMs caps a long Retry-After', () => {
  const response = new Response(null, { status: 429, headers: { 'Retry-After': '600' } })
  assertEquals(rateLimitWaitMs(response, 0), 30_000)
})

Deno.test('listCategories reads the whole taxonomy in one request', async () => {
  const calls: string[] = []
  const fetchImpl: typeof fetch = (input) => {
    calls.push(String(input))
    return Promise.resolve(jsonResponse({
      data: [
        {
          id: 'good-life',
          attributes: { name: 'Good Life' },
          relationships: { parent: { data: null } },
        },
        {
          id: 'restaurants-and-cafes',
          attributes: { name: 'Restaurants & Cafes' },
          relationships: { parent: { data: { id: 'good-life' } } },
        },
      ],
    }))
  }

  const categories = await new UpClient('token', 'https://up.test', fetchImpl).listCategories()
  assertEquals(calls, ['https://up.test/categories'])
  assertEquals(categories.map((c) => c.id), ['good-life', 'restaurants-and-cafes'])
})

Deno.test('categoriseTransaction PATCHes the child category', async () => {
  let request: { url: string; init?: RequestInit } | null = null
  const fetchImpl: typeof fetch = (input, init) => {
    request = { url: String(input), init }
    return Promise.resolve(new Response(null, { status: 204 }))
  }

  await new UpClient('token', 'https://up.test', fetchImpl).categoriseTransaction(
    'tx-1',
    'gifts-and-charity',
  )
  const sent = request!
  assertEquals(sent.url, 'https://up.test/transactions/tx-1/relationships/category')
  assertEquals(sent.init?.method, 'PATCH')
  assertEquals(new Headers(sent.init?.headers).get('Authorization'), 'Bearer token')
  assertEquals(JSON.parse(String(sent.init?.body)), {
    data: { type: 'categories', id: 'gifts-and-charity' },
  })
})

Deno.test('categoriseTransaction clears the category with null data', async () => {
  let body = ''
  const fetchImpl: typeof fetch = (_input, init) => {
    body = String(init?.body)
    return Promise.resolve(new Response(null, { status: 204 }))
  }

  await new UpClient('token', 'https://up.test', fetchImpl).categoriseTransaction('tx-1', null)
  assertEquals(JSON.parse(body), { data: null })
})

Deno.test('categoriseTransaction throws an UpApiError on a 429 without retrying', async () => {
  let calls = 0
  const fetchImpl: typeof fetch = () => {
    calls++
    return Promise.resolve(new Response('slow down', { status: 429 }))
  }

  const error = await assertRejects(
    () => new UpClient('token', 'https://up.test', fetchImpl).categoriseTransaction('tx-1', null),
    UpApiError,
  )
  assertEquals(error.status, 429)
  assertEquals(calls, 1)
})

Deno.test('categoriseTransaction retries a 429 after Retry-After when asked to', async () => {
  const waits: number[] = []
  let calls = 0
  const fetchImpl: typeof fetch = () => {
    calls++
    return Promise.resolve(
      calls < 3
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } })
        : new Response(null, { status: 204 }),
    )
  }

  await new UpClient('token', 'https://up.test', fetchImpl, (ms) => {
    waits.push(ms)
    return Promise.resolve()
  }).categoriseTransaction('tx-1', null, 3)
  assertEquals(calls, 3)
  assertEquals(waits, [2000, 2000])
})

Deno.test('createWebhook posts the url and returns the id and once-only secret', async () => {
  let request: { url: string; init?: RequestInit } | undefined
  const fetchImpl: typeof fetch = (input, init) => {
    request = { url: String(input), init }
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: { id: 'wh-1', attributes: { url: 'u', secretKey: 'shh' } } }),
        { status: 201 },
      ),
    )
  }

  const created = await new UpClient('token', 'https://up.test', fetchImpl)
    .createWebhook('https://nest.test/hook', 'Nest')

  assertEquals(created, { id: 'wh-1', secretKey: 'shh' })
  assertEquals(request?.url, 'https://up.test/webhooks')
  assertEquals(request?.init?.method, 'POST')
  assertEquals(JSON.parse(String(request?.init?.body)), {
    data: { attributes: { url: 'https://nest.test/hook', description: 'Nest' } },
  })
})

Deno.test('createWebhook throws UpApiError on a rejection', async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('cap', { status: 400 }))
  const error = await assertRejects(
    () => new UpClient('token', 'https://up.test', fetchImpl).createWebhook('u', 'Nest'),
    UpApiError,
  )
  assertEquals(error.status, 400)
})

Deno.test('deleteWebhook treats a 404 as deleted and throws on anything else', async () => {
  const calls: string[] = []
  let status = 404
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push(`${init?.method} ${String(input)}`)
    return Promise.resolve(new Response(null, { status }))
  }
  const client = new UpClient('token', 'https://up.test', fetchImpl)

  await client.deleteWebhook('wh-1')
  status = 204
  await client.deleteWebhook('wh-1')
  status = 500
  await assertRejects(() => client.deleteWebhook('wh-1'), UpApiError)
  assertEquals(calls[0], 'DELETE https://up.test/webhooks/wh-1')
})

Deno.test('listWebhooks walks every page', async () => {
  const fetchImpl: typeof fetch = (input) =>
    Promise.resolve(
      String(input).includes('after=')
        ? jsonResponse({ data: [{ id: 'wh-2', attributes: { url: 'b' } }], links: { next: null } })
        : jsonResponse({
          data: [{ id: 'wh-1', attributes: { url: 'a' } }],
          links: { next: 'https://up.test/webhooks?after=x' },
        }),
    )
  const webhooks = await new UpClient('token', 'https://up.test', fetchImpl).listWebhooks()
  assertEquals(webhooks.map((w) => w.id), ['wh-1', 'wh-2'])
})
