import { describe, expect, it, vi } from 'vitest'
import { createHandler } from './http.ts'
import { fakeContext, members } from './test/fakeContext.ts'

const config = {
  supabaseUrl: 'https://p.supabase.co',
  anonKey: 'anon',
  origin: 'https://mcp.nest.willsawyerrrr.dev/',
}
const metadata = 'https://mcp.nest.willsawyerrrr.dev/.well-known/oauth-protected-resource'

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
}

function post(body: unknown, token?: string): Request {
  return new Request('https://mcp.nest.willsawyerrrr.dev/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function handler(verified = true) {
  const { ctx } = fakeContext({ tables: { members, wishlist_item: [] } })
  const verify = vi.fn(async (token: string) =>
    verified && token === 'good' ? { userId: 'u1', supabase: ctx.supabase } : null,
  )
  const context = vi.fn(async () => ctx)
  return { handle: createHandler(config, { verify, context }), verify, context }
}

describe('protected resource metadata', () => {
  it('names the resource and Supabase Auth as its authorization server', async () => {
    const response = await handler().handle(new Request(metadata))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource: 'https://mcp.nest.willsawyerrrr.dev/mcp',
      authorization_servers: ['https://p.supabase.co/auth/v1'],
      bearer_methods_supported: ['header'],
      resource_name: 'Nest',
    })
  })

  it('is also served at the resource-specific path', async () => {
    const response = await handler().handle(new Request(`${metadata}/mcp`))
    expect(response.status).toBe(200)
  })
})

describe('authentication', () => {
  it('challenges a request with no token and points at the metadata', async () => {
    const { handle, verify } = handler()
    const response = await handle(post(initialize))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${metadata}"`)
    expect(verify).not.toHaveBeenCalled()
  })

  it('challenges an invalid token', async () => {
    const response = await handler().handle(post(initialize, 'bad'))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", resource_metadata="${metadata}"`,
    )
  })

  it('refuses a verified user who is not a household member', async () => {
    const verify = vi.fn(async () => ({ userId: 'u', supabase: fakeContext().ctx.supabase }))
    const context = vi.fn(async () => {
      throw new Error('no member')
    })
    const response = await createHandler(config, { verify, context })(post(initialize, 'good'))
    expect(response.status).toBe(403)
  })

  it('answers 404 elsewhere', async () => {
    const response = await handler().handle(new Request('https://mcp.nest.willsawyerrrr.dev/x'))
    expect(response.status).toBe(404)
  })
})

describe('tool wiring', () => {
  it('serves the tools to a verified member, one stateless request at a time', async () => {
    const { handle, context } = handler()
    const init = await handle(post(initialize, 'good'))
    expect(init.status).toBe(200)
    expect(init.headers.get('mcp-session-id')).toBeNull()

    const list = await handle(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'good'))
    const { result } = (await list.json()) as { result: { tools: { name: string }[] } }
    expect(result.tools.map((tool) => tool.name)).toContain('create_deduction_from_document')
    expect(context).toHaveBeenCalledTimes(2)
  })

  it('runs a tool as the verified member', async () => {
    const response = await handler().handle(
      post(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list_wishlist', arguments: {} },
        },
        'good',
      ),
    )
    const { result } = (await response.json()) as { result: { isError?: boolean } }
    expect(result.isError).toBeFalsy()
  })

  it('builds the default context from the verified member without local files', async () => {
    const supabase = fakeContext({
      tables: { members: [{ id: 'm', household_id: 'h', user_id: 'u1' }] },
    }).ctx.supabase
    const verify = vi.fn(async () => ({ userId: 'u1', supabase }))
    const response = await createHandler(config, { verify })(post(initialize, 'good'))
    expect(response.status).toBe(200)
  })
})
