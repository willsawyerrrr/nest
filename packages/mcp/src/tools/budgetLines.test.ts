import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext } from '../test/fakeContext.ts'
import { addBudgetLine, updateBudgetLine } from './budgetLines.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const line = {
  id: ID,
  household_id: 'h-1',
  name: 'Netflix',
  line_group: 'wants',
  amount_cents: 22_99,
  frequency: 'monthly',
  interval_count: null,
  management_url: null,
  breakdown_id: null,
  is_gift_line: false,
}

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

describe('addBudgetLine', () => {
  it('inserts a manual line into the household, normalising the link', async () => {
    const { ctx, state } = fakeContext()
    const result = await addBudgetLine(ctx, {
      name: 'Netflix',
      group: 'wants',
      amount_cents: 22_99,
      frequency: 'monthly',
      management_url: 'netflix.com/account',
    })
    expect(state.inserts).toEqual([
      {
        table: 'budget_line',
        row: {
          household_id: 'h-1',
          name: 'Netflix',
          line_group: 'wants',
          amount_cents: 22_99,
          frequency: 'monthly',
          interval_count: null,
          management_url: 'https://netflix.com/account',
        },
      },
    ])
    expect(result).toMatchObject({ id: 'new-id', management_url: 'https://netflix.com/account' })
  })

  it('requires an interval count for an every-N frequency only', async () => {
    const { ctx } = fakeContext()
    const base = { name: 'Rego', group: 'needs', amount_cents: 1_00 } as const
    expect((await failure(addBudgetLine(ctx, { ...base, frequency: 'every_n_weeks' }))).code).toBe(
      'invalid_details',
    )
    expect(
      (await failure(addBudgetLine(ctx, { ...base, frequency: 'weekly', interval_count: 2 }))).code,
    ).toBe('invalid_details')
    await expect(
      addBudgetLine(ctx, { ...base, frequency: 'every_n_months', interval_count: 3 }),
    ).resolves.toMatchObject({ interval_count: 3 })
  })

  it('reports a failed insert with fixed copy', async () => {
    const { ctx } = fakeContext({ insertError: true })
    const error = await failure(
      addBudgetLine(ctx, { name: 'A', group: 'needs', amount_cents: 1, frequency: 'weekly' }),
    )
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('updateBudgetLine', () => {
  it('changes only the given fields', async () => {
    const { ctx, state } = fakeContext({ tables: { budget_line: [line] } })
    await updateBudgetLine(ctx, { id: ID, amount_cents: 25_99 })
    expect(state.updates).toEqual([
      {
        table: 'budget_line',
        row: {
          name: 'Netflix',
          line_group: 'wants',
          amount_cents: 25_99,
          frequency: 'monthly',
          interval_count: null,
          management_url: null,
        },
        filters: [
          ['id', ID],
          ['household_id', 'h-1'],
        ],
      },
    ])
  })

  it('clears the link with null and drops the count when the frequency becomes fixed', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        budget_line: [
          {
            ...line,
            frequency: 'every_n_weeks',
            interval_count: 3,
            management_url: 'https://a.io',
          },
        ],
      },
    })
    await updateBudgetLine(ctx, { id: ID, frequency: 'weekly', management_url: null })
    expect(state.updates[0]?.row).toMatchObject({
      frequency: 'weekly',
      interval_count: null,
      management_url: null,
    })
  })

  it('refuses a derived line', async () => {
    const { ctx, state } = fakeContext({
      tables: { budget_line: [{ ...line, breakdown_id: 'b-1' }] },
    })
    expect((await failure(updateBudgetLine(ctx, { id: ID, name: 'X' }))).code).toBe('derived_line')
    expect(state.updates).toEqual([])
  })

  it('reports an unknown or unreadable line as not found', async () => {
    const { ctx } = fakeContext()
    expect((await failure(updateBudgetLine(ctx, { id: ID, name: 'X' }))).code).toBe('not_found')
  })

  it('reports a failed update with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { budget_line: [line] }, updateError: true })
    const error = await failure(updateBudgetLine(ctx, { id: ID, name: 'X' }))
    expect(error.code).toBe('save_failed')
  })
})
