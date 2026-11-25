import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext } from '../test/fakeContext.ts'
import {
  addBudgetLine,
  deleteBudgetLine,
  retireBudgetLine,
  updateBudgetLine,
} from './budgetLines.ts'

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
  goal_id: null,
  destination_account_id: null,
  allowance_member_id: null,
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
          goal_id: null,
          destination_account_id: null,
          allowance_member_id: null,
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
          goal_id: null,
          destination_account_id: null,
          allowance_member_id: null,
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

describe('budget line lifespan', () => {
  it('adds a line from a start date', async () => {
    const { ctx, state } = fakeContext()
    const result = await addBudgetLine(ctx, {
      name: 'Holiday',
      group: 'wants',
      amount_cents: 100_00,
      frequency: 'monthly',
      starts_on: '2027-03-01',
    })
    expect(state.inserts[0]?.row).toMatchObject({ starts_on: '2027-03-01' })
    expect(result.starts_on).toBe('2027-03-01')
  })

  it('changes a line from a date through change_budget_line_from, keeping the rest', async () => {
    const { ctx, state } = fakeContext({
      tables: { budget_line: [line] },
      rpcResults: { change_budget_line_from: 'replacement-id' },
    })
    const result = await updateBudgetLine(ctx, {
      id: ID,
      amount_cents: 25_99,
      change_from: '2026-11-01',
    })
    expect(state.updates).toEqual([])
    expect(state.rpcCalls).toEqual([
      {
        fn: 'change_budget_line_from',
        args: {
          p_budget_line_id: ID,
          p_change_on: '2026-11-01',
          p_line_group: 'wants',
          p_name: 'Netflix',
          p_amount_cents: 25_99,
          p_frequency: 'monthly',
        },
      },
    ])
    expect(result).toMatchObject({ id: 'replacement-id', replaces: ID, starts_on: '2026-11-01' })
  })

  it('refuses a change from a date that touches a field it does not carry', async () => {
    const { ctx, state } = fakeContext({ tables: { budget_line: [line] } })
    const error = await failure(
      updateBudgetLine(ctx, { id: ID, change_from: '2026-11-01', management_url: null }),
    )
    expect(error.code).toBe('invalid_details')
    expect(state.rpcCalls).toEqual([])
  })

  it('refuses deleting a line with counted spend, pointing at retiring', async () => {
    const { ctx } = fakeContext({
      tables: { budget_line: [line] },
      deleteError: true,
      failureMessage: 'budget_line_has_spend',
    })
    const error = await failure(deleteBudgetLine(ctx, { id: ID }))
    expect(error.code).toBe('has_counted_spend')
    expect(error.message).toContain('retire_budget_line')
  })

  it('deletes a line no spend has counted toward', async () => {
    const { ctx, state } = fakeContext({ tables: { budget_line: [line] } })
    await expect(deleteBudgetLine(ctx, { id: ID })).resolves.toEqual({ id: ID })
    expect(state.deletes).toHaveLength(1)
  })

  it('retires a line from today by default', async () => {
    const { ctx, state } = fakeContext({ tables: { budget_line: [line] } })
    const result = await retireBudgetLine(ctx, { id: ID })
    expect(state.rpcCalls).toEqual([
      { fn: 'retire_budget_line', args: { p_budget_line_id: ID, p_retire_on: '2026-10-02' } },
    ])
    expect(result).toEqual({ id: ID, retired_on: '2026-10-02' })
  })

  it('names the replacement the default item needs', async () => {
    const { ctx } = fakeContext({
      tables: { budget_line: [line] },
      rpcError: true,
      failureMessage: 'budget_line_default_replacement_required',
    })
    expect((await failure(retireBudgetLine(ctx, { id: ID }))).code).toBe(
      'default_replacement_required',
    )
  })

  it('refuses retiring a derived line', async () => {
    const { ctx, state } = fakeContext({
      tables: { budget_line: [{ ...line, is_gift_line: true }] },
    })
    expect((await failure(retireBudgetLine(ctx, { id: ID }))).code).toBe('derived_line')
    expect(state.rpcCalls).toEqual([])
  })
})
