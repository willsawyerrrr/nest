import { describe, expect, it } from 'vitest'
import { failure } from '../test/failure.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import { addBudgetLine, deleteBudgetLine, updateBudgetLine } from './budgetLines.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'
const GOAL = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const ACCOUNT = '2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bee'
const base = {
  id: ID,
  household_id: 'h-1',
  name: 'Fun',
  line_group: 'discretionary',
  amount_cents: 10_00,
  frequency: 'weekly',
  interval_count: null,
  management_url: null,
  breakdown_id: null,
  is_gift_line: false,
  goal_id: null,
  destination_account_id: null,
  allowance_member_id: null,
}
const tables = {
  members,
  savings_goal: [{ id: GOAL }],
  account_directory: [{ id: ACCOUNT, type: 'transaction', source: 'up' }],
}

describe('addBudgetLine links', () => {
  it('funds a goal from a savings line', async () => {
    const { ctx, state } = fakeContext({ tables })
    const result = await addBudgetLine(ctx, {
      name: 'Holiday',
      group: 'savings',
      amount_cents: 50_00,
      frequency: 'fortnightly',
      goal_id: GOAL,
    })
    expect(state.inserts[0]?.row).toMatchObject({
      goal_id: GOAL,
      destination_account_id: null,
      allowance_member_id: null,
    })
    expect(result.goal_id).toBe(GOAL)
  })

  it('routes a non-savings line to an account', async () => {
    const { ctx, state } = fakeContext({ tables })
    await addBudgetLine(ctx, {
      name: 'Rent',
      group: 'needs',
      amount_cents: 1,
      frequency: 'weekly',
      destination_account_id: ACCOUNT,
    })
    expect(state.inserts[0]?.row).toMatchObject({ destination_account_id: ACCOUNT })
  })

  it('draws a discretionary line from the signed-in member allowance', async () => {
    const { ctx, state } = fakeContext({ tables })
    await addBudgetLine(ctx, {
      name: 'Games',
      group: 'discretionary',
      amount_cents: 1,
      frequency: 'weekly',
      allowance_member: 'Alex',
    })
    expect(state.inserts[0]?.row).toMatchObject({ allowance_member_id: 'm-self' })
  })

  it('refuses a co-member allowance and the wrong group for each link', async () => {
    const { ctx } = fakeContext({ tables })
    const line = { name: 'X', amount_cents: 1, frequency: 'weekly' } as const
    const cases = [
      { group: 'discretionary', allowance_member: 'Sam' },
      { group: 'needs', allowance_member: 'Alex' },
      { group: 'needs', goal_id: GOAL },
      { group: 'savings', destination_account_id: ACCOUNT },
      { group: 'discretionary', allowance_member: 'Alex', destination_account_id: ACCOUNT },
    ] as const
    for (const extra of cases) {
      expect((await failure(addBudgetLine(ctx, { ...line, ...extra }))).code).toBe(
        'invalid_details',
      )
    }
  })

  it('refuses an unknown goal or account', async () => {
    const { ctx } = fakeContext({ tables: { ...tables, savings_goal: [], account_directory: [] } })
    const line = { name: 'X', amount_cents: 1, frequency: 'weekly' } as const
    expect(
      (await failure(addBudgetLine(ctx, { ...line, group: 'savings', goal_id: GOAL }))).code,
    ).toBe('not_found')
    expect(
      (
        await failure(
          addBudgetLine(ctx, { ...line, group: 'needs', destination_account_id: ACCOUNT }),
        )
      ).code,
    ).toBe('invalid_account')
  })

  it('reports an overdrawn allowance by code with fixed copy', async () => {
    const { ctx } = fakeContext({
      tables,
      insertError: true,
      failureMessage: 'allowance_overdrawn',
    })
    const error = await failure(
      addBudgetLine(ctx, {
        name: 'Games',
        group: 'discretionary',
        amount_cents: 1,
        frequency: 'weekly',
        allowance_member: 'Alex',
      }),
    )
    expect(error.code).toBe('allowance_overdrawn')
    expect(error.message).toBe('The allowance cannot cover what is drawn from it.')
  })
})

describe('updateBudgetLine links', () => {
  it('draws a line from the allowance, clearing its own destination', async () => {
    const { ctx, state } = fakeContext({
      tables: { ...tables, budget_line: [{ ...base, destination_account_id: ACCOUNT }] },
    })
    await updateBudgetLine(ctx, { id: ID, allowance_member: 'Alex' })
    expect(state.updates[0]?.row).toMatchObject({
      allowance_member_id: 'm-self',
      destination_account_id: null,
    })
  })

  it('releases a line from its allowance when given null', async () => {
    const { ctx, state } = fakeContext({
      tables: { ...tables, budget_line: [{ ...base, allowance_member_id: 'm-self' }] },
    })
    await updateBudgetLine(ctx, { id: ID, allowance_member: null })
    expect(state.updates[0]?.row).toMatchObject({ allowance_member_id: null })
  })

  it('clears what the new group cannot carry', async () => {
    const { ctx, state } = fakeContext({
      tables: { ...tables, budget_line: [{ ...base, allowance_member_id: 'm-self' }] },
    })
    await updateBudgetLine(ctx, { id: ID, group: 'savings', goal_id: GOAL })
    expect(state.updates[0]?.row).toMatchObject({
      line_group: 'savings',
      goal_id: GOAL,
      allowance_member_id: null,
      destination_account_id: null,
    })
  })

  it('keeps existing links when none are given', async () => {
    const { ctx, state } = fakeContext({
      tables: { ...tables, budget_line: [{ ...base, line_group: 'savings', goal_id: GOAL }] },
    })
    await updateBudgetLine(ctx, { id: ID, name: 'Trip' })
    expect(state.updates[0]?.row).toMatchObject({ goal_id: GOAL })
  })

  it('reports an overdrawn allowance by code', async () => {
    const { ctx } = fakeContext({
      tables: { ...tables, budget_line: [base] },
      updateError: true,
      failureMessage: 'allowance_overdrawn',
    })
    expect((await failure(updateBudgetLine(ctx, { id: ID, amount_cents: 1 }))).code).toBe(
      'allowance_overdrawn',
    )
  })
})

describe('deleteBudgetLine', () => {
  it('deletes a manual line', async () => {
    const { ctx, state } = fakeContext({ tables: { budget_line: [base] } })
    await expect(deleteBudgetLine(ctx, { id: ID })).resolves.toEqual({ id: ID })
    expect(state.deletes).toEqual([
      {
        table: 'budget_line',
        filters: [
          ['id', ID],
          ['household_id', 'h-1'],
        ],
      },
    ])
  })

  it('refuses derived lines and unknown ids', async () => {
    const derived = fakeContext({ tables: { budget_line: [{ ...base, breakdown_id: 'b-1' }] } })
    expect((await failure(deleteBudgetLine(derived.ctx, { id: ID }))).code).toBe('derived_line')
    const gift = fakeContext({ tables: { budget_line: [{ ...base, is_gift_line: true }] } })
    expect((await failure(deleteBudgetLine(gift.ctx, { id: ID }))).code).toBe('derived_line')
    expect(derived.state.deletes).toEqual([])
    const none = fakeContext()
    expect((await failure(deleteBudgetLine(none.ctx, { id: ID }))).code).toBe('not_found')
  })

  it('reports a failed delete with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { budget_line: [base] }, deleteError: true })
    const error = await failure(deleteBudgetLine(ctx, { id: ID }))
    expect(error.code).toBe('delete_failed')
    expect(error.message).not.toContain('upstream')
  })
})
