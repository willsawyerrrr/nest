import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext } from '../test/fakeContext.ts'
import {
  getHousehold,
  listAccounts,
  listCategories,
  listMembers,
  listTransactions,
  setAccountNetWorthExclusion,
  setMemberDateOfBirth,
  setPayAccount,
} from './ledger.ts'

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

const base = { type: 'transaction', source: 'up', deleted_from_source_at: null }
const own = { ...base, id: 'a-own', name: 'Alex Spending', owner_member_id: 'm-self' }
const joint = { ...base, id: 'a-joint', name: 'Joint', owner_member_id: null }
const theirs = { ...base, id: 'a-sam', name: "Sam's Spending", owner_member_id: 'm-other' }
const tables = {
  accounts: [own, joint, theirs].map((a) => ({ ...a, household_id: 'h-1' })),
  members: [
    { id: 'm-self', name: 'Alex', date_of_birth: '1990-05-01', email: 'a@x.test' },
    { id: 'm-other', name: 'Sam', date_of_birth: null, email: 's@x.test' },
  ],
  accounts_with_balance: [
    { ...own, balance_cents: 1_234_56, exclude_from_net_worth: false },
    { ...joint, balance_cents: 9_00, exclude_from_net_worth: true },
  ],
  account_directory: [own, joint, theirs],
}

describe('listAccounts', () => {
  it('shows a co-member spending account by name with no balance', async () => {
    const { ctx } = fakeContext({ tables })
    const { accounts } = await listAccounts(ctx)
    expect(accounts.map((a) => a.name)).toEqual(['Alex Spending', 'Joint', "Sam's Spending"])
    expect(accounts[0]).toMatchObject({
      balance_visible: true,
      balance_cents: 1_234_56,
      owner: 'Alex',
      exclude_from_net_worth: false,
    })
    expect(accounts[1]).toMatchObject({ owner: null, exclude_from_net_worth: true })
    expect(accounts[2]).toMatchObject({
      balance_visible: false,
      balance_cents: null,
      exclude_from_net_worth: null,
      owner: 'Sam',
    })
  })
})

describe('setAccountNetWorthExclusion', () => {
  it('updates the flag on the named account in the household', async () => {
    const { ctx, state } = fakeContext({ tables })
    const result = await setAccountNetWorthExclusion(ctx, { account: 'joint', excluded: true })
    expect(state.updates).toEqual([
      {
        table: 'accounts',
        row: { exclude_from_net_worth: true },
        filters: [
          ['id', 'a-joint'],
          ['household_id', 'h-1'],
        ],
      },
    ])
    expect(result).toEqual({ id: 'a-joint', name: 'Joint', exclude_from_net_worth: true })
  })

  it('refuses an unknown or ambiguous account and reports a failed save with fixed copy', async () => {
    const { ctx } = fakeContext({ tables })
    expect(
      (await failure(setAccountNetWorthExclusion(ctx, { account: 'x', excluded: true }))).code,
    ).toBe('not_found')
    const dup = fakeContext({
      tables: { ...tables, account_directory: [own, { ...joint, name: 'Alex Spending' }] },
    })
    expect(
      (
        await failure(
          setAccountNetWorthExclusion(dup.ctx, { account: 'alex spending', excluded: true }),
        )
      ).code,
    ).toBe('invalid_details')
    const failing = fakeContext({ tables, updateError: true })
    const error = await failure(
      setAccountNetWorthExclusion(failing.ctx, { account: 'a-own', excluded: true }),
    )
    expect(error).toMatchObject({ code: 'save_failed', message: 'The record could not be saved.' })
  })
})

describe('members', () => {
  it('lists names and dates of birth without emails', async () => {
    const { ctx } = fakeContext({ tables })
    const { members } = await listMembers(ctx)
    expect(members).toEqual([
      { id: 'm-self', name: 'Alex', date_of_birth: '1990-05-01', is_you: true },
      { id: 'm-other', name: 'Sam', date_of_birth: null, is_you: false },
    ])
  })

  it('sets a co-member date of birth through the RPC', async () => {
    const { ctx, state } = fakeContext({ tables })
    await setMemberDateOfBirth(ctx, { member: 'sam', date_of_birth: '1992-02-29' })
    expect(state.rpcCalls).toEqual([
      {
        fn: 'set_member_date_of_birth',
        args: { p_member_id: 'm-other', p_date_of_birth: '1992-02-29' },
      },
    ])
    await setMemberDateOfBirth(ctx, { member: 'Sam', date_of_birth: null })
    expect(state.rpcCalls[1]?.args).toEqual({ p_member_id: 'm-other', p_date_of_birth: null })
  })

  it('rejects impossible, future, and unknown inputs', async () => {
    const { ctx, state } = fakeContext({ tables })
    for (const date_of_birth of ['2026-02-30', '2030-01-01']) {
      expect(
        (await failure(setMemberDateOfBirth(ctx, { member: 'Sam', date_of_birth }))).code,
      ).toBe('invalid_details')
    }
    expect(
      (await failure(setMemberDateOfBirth(ctx, { member: 'Nobody', date_of_birth: null }))).code,
    ).toBe('not_found')
    expect(state.rpcCalls).toEqual([])
    const failing = fakeContext({ tables, rpcError: true })
    expect(
      (await failure(setMemberDateOfBirth(failing.ctx, { member: 'Sam', date_of_birth: null })))
        .code,
    ).toBe('save_failed')
  })
})

describe('household and pay account', () => {
  const households = [
    { id: 'h-1', name: 'Home', timezone: 'Australia/Sydney', pay_account_id: 'a-own' },
  ]

  it('reports the pay account by name', async () => {
    const { ctx } = fakeContext({ tables: { ...tables, households } })
    expect(await getHousehold(ctx)).toEqual({
      id: 'h-1',
      name: 'Home',
      timezone: 'Australia/Sydney',
      pay_account: { id: 'a-own', name: 'Alex Spending' },
    })
  })

  it('reports no pay account, and a missing household', async () => {
    const none = fakeContext({
      tables: { households: [{ ...households[0], pay_account_id: null }] },
    })
    expect((await getHousehold(none.ctx)).pay_account).toBeNull()
    expect((await failure(getHousehold(fakeContext().ctx))).code).toBe('not_found')
  })

  it('sets and clears the pay account through the RPC', async () => {
    const { ctx, state } = fakeContext({ tables })
    expect(await setPayAccount(ctx, { account: 'Joint' })).toEqual({
      pay_account: { id: 'a-joint', name: 'Joint' },
    })
    expect(await setPayAccount(ctx, { account: null })).toEqual({ pay_account: null })
    expect(state.rpcCalls).toEqual([
      { fn: 'set_household_pay_account', args: { p_account_id: 'a-joint' } },
      { fn: 'set_household_pay_account', args: { p_account_id: null } },
    ])
  })

  it('refuses an unknown account and reports an RPC failure with fixed copy', async () => {
    const { ctx } = fakeContext({ tables })
    expect((await failure(setPayAccount(ctx, { account: 'nope' }))).code).toBe('not_found')
    const failing = fakeContext({ tables, rpcError: true })
    expect(await failure(setPayAccount(failing.ctx, { account: 'Joint' }))).toMatchObject({
      code: 'save_failed',
      message: 'The record could not be saved.',
    })
  })
})

describe('listCategories', () => {
  const categories = [
    { id: 'c1', name: 'Groceries', kind: 'expense', parent_id: null, is_archived: false },
    { id: 'c2', name: 'Old', kind: 'expense', parent_id: 'c1', is_archived: true },
    { id: 'c3', name: 'Salary', kind: 'income', parent_id: null, is_archived: false },
  ]

  it('hides archived categories unless asked', async () => {
    const { ctx } = fakeContext({ tables: { categories } })
    expect((await listCategories(ctx, {})).categories.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(
      (await listCategories(ctx, { include_archived: true })).categories.map((c) => c.id),
    ).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('listTransactions', () => {
  const row = (id: string, posted_at: string, extra: Record<string, unknown> = {}) => ({
    id,
    account_id: 'a-own',
    member_id: null,
    category_id: null,
    posted_at,
    amount_cents: -10_00,
    description: id,
    kind: 'expense',
    status: 'settled',
    external_category: null,
    ...extra,
  })
  const transactions = [
    row('t1', '2026-09-01T00:00:00Z'),
    row('t2', '2026-10-01T00:00:00Z', { external_category: 'gifts-and-charity' }),
    row('t3', '2026-09-15T00:00:00Z', { account_id: 'a-joint', kind: 'income' }),
  ]

  it('lists newest first with a limit and reports the total', async () => {
    const { ctx } = fakeContext({ tables: { ...tables, transactions } })
    const result = await listTransactions(ctx, { limit: 2 })
    expect(result.total).toBe(3)
    expect(result.transactions.map((t) => t.id)).toEqual(['t2', 't3'])
  })

  it('filters by account, kind, source category, and dates', async () => {
    const { ctx } = fakeContext({ tables: { ...tables, transactions } })
    const ids = async (input: Parameters<typeof listTransactions>[1]) =>
      (await listTransactions(ctx, input)).transactions.map((t) => t.id)
    expect(await ids({ account: 'Joint' })).toEqual(['t3'])
    expect(await ids({ kind: 'expense' })).toEqual(['t2', 't1'])
    expect(await ids({ external_category: 'gifts-and-charity' })).toEqual(['t2'])
    expect(await ids({ from: '2026-09-10', to: '2026-09-30' })).toEqual(['t3'])
  })
})
