import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { ToolError } from './errors.ts'
import { createServer, respond } from './server.ts'
import { fakeContext, members } from './test/fakeContext.ts'

async function connect(options: Parameters<typeof fakeContext>[0]) {
  const { ctx, state } = fakeContext(options)
  const server = createServer(ctx)
  const client = new Client({ name: 'test', version: '0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return { client, state }
}

describe('respond', () => {
  it('serialises a result', async () => {
    const result = await respond(async () => ({ a: 1 }))
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ a: 1 })
  })

  it('reports a ToolError as its code and message', async () => {
    const result = await respond(async () => {
      throw new ToolError('not_found', 'nope')
    })
    expect(result.isError).toBe(true)
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      code: 'not_found',
      message: 'nope',
    })
  })

  it('hides an unexpected failure behind a stable code', async () => {
    const result = await respond(async () => {
      throw new Error('upstream detail')
    })
    const text = (result.content[0] as { text: string }).text
    expect(JSON.parse(text).code).toBe('query_failed')
    expect(text).not.toContain('upstream')
  })
})

describe('the server', () => {
  it('lists the six tools', async () => {
    const { client } = await connect({})
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_wishlist_item',
      'create_deduction_from_document',
      'get_fortnightly_buffer',
      'list_budget_lines',
      'list_savings_goals',
      'list_wishlist',
    ])
  })

  it('answers a read tool', async () => {
    const { client } = await connect({
      tables: {
        wishlist_item: [{ id: 'w', name: 'Bike', amount_cents: 5_00, member_id: null, note: null }],
        members,
      },
    })
    const result = await client.callTool({ name: 'list_wishlist', arguments: {} })
    const text = (result.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).items[0].name).toBe('Bike')
  })

  it('runs the write tools through their schemas', async () => {
    const { client, state } = await connect({ tables: { members } })
    const added = await client.callTool({
      name: 'add_wishlist_item',
      arguments: { name: 'Bike', amount_cents: 5_00, member: 'Sam' },
    })
    expect(added.isError).toBeFalsy()
    expect(state.inserts).toHaveLength(1)

    const bad = await client.callTool({
      name: 'add_wishlist_item',
      arguments: { name: 'Bike', amount_cents: 5.5 },
    })
    expect(bad.isError).toBe(true)
  })

  it('runs the deduction tool with a missing file as a stable error', async () => {
    const { client } = await connect({ tables: { members } })
    const result = await client.callTool({
      name: 'create_deduction_from_document',
      arguments: { file_path: '/missing.pdf' },
    })
    expect(result.isError).toBe(true)
    expect(JSON.parse((result.content as { text: string }[])[0]!.text).code).toBe('file_unreadable')
  })

  it('answers the other read tools', async () => {
    const { client } = await connect({
      tables: {
        budget_line: [],
        savings_goal: [],
        accounts_with_balance: [],
        inflows: [],
        tax_profile: [],
        super_contribution: [],
        help_debt: [],
        deduction: [],
        members,
        temporary_item: [],
      },
    })
    for (const name of ['list_budget_lines', 'list_savings_goals', 'get_fortnightly_buffer']) {
      const result = await client.callTool({ name, arguments: {} })
      expect(result.isError, name).toBeFalsy()
    }
  })
})
