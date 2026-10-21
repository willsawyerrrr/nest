import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { createServer } from '../server.ts'
import { fakeContext, members } from '../test/fakeContext.ts'

async function connect(options: Parameters<typeof fakeContext>[0]) {
  const { ctx, state } = fakeContext(options)
  const server = createServer(ctx)
  const client = new Client({ name: 'test', version: '0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return { client, state }
}

describe('the income, tax, super, and equity tools', () => {
  it('are all registered', async () => {
    const { client } = await connect({})
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'list_inflows',
        'add_inflow',
        'update_inflow',
        'delete_inflow',
        'list_tax_profiles',
        'set_tax_profile',
        'list_help_debts',
        'set_help_debt',
        'get_tax_estimate',
        'list_super_profiles',
        'set_super_profile',
        'list_super_contributions',
        'add_super_contribution',
        'update_super_contribution',
        'delete_super_contribution',
        'list_equity_grants',
        'add_equity_grant',
        'update_equity_grant',
        'delete_equity_grant',
      ]),
    )
  })

  it('write through the server and report a refusal as a stable code', async () => {
    const { client, state } = await connect({ tables: { members } })
    const added = await client.callTool({
      name: 'add_inflow',
      arguments: {
        name: 'Pay',
        type: 'salary',
        member: 'Alex',
        amount_cents: 1_00,
        schedule: 'annual',
      },
    })
    expect(added.isError).toBeFalsy()
    expect(state.inserts[0]?.table).toBe('inflows')

    const refused = await client.callTool({
      name: 'add_inflow',
      arguments: { name: 'Pay', type: 'salary', member: 'Alex', amount_cents: 1_00 },
    })
    expect(refused.isError).toBe(true)
    const text = (refused.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).code).toBe('invalid_details')
  })
})
