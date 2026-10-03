import { describe, expect, it } from 'vitest'
import { summariseHouseholdFromRows } from '@nest/household'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import { getFortnightlyBuffer, listBudgetLines, listSavingsGoals, listWishlist } from './read.ts'

const line = (overrides: Record<string, unknown>) => ({
  id: 'l',
  name: 'Rent',
  line_group: 'needs',
  amount_cents: 500_00,
  frequency: 'weekly',
  interval_count: null,
  management_url: null,
  is_gift_line: false,
  breakdown_id: null,
  goal_id: null,
  destination_account_id: null,
  allowance_member_id: null,
  ...overrides,
})

describe('listBudgetLines', () => {
  const tables = {
    budget_line: [
      line({ id: 'a', name: 'Rent' }),
      line({
        id: 'b',
        name: 'Netflix',
        line_group: 'wants',
        amount_cents: 20_00,
        frequency: 'monthly',
        management_url: 'https://netflix.com',
      }),
      line({ id: 'c', name: 'Gifts', line_group: 'wants', is_gift_line: true }),
      line({
        id: 'd',
        name: 'Meds',
        line_group: 'needs',
        frequency: 'every_n_weeks',
        interval_count: 4,
        amount_cents: 100_00,
        breakdown_id: 'bd',
      }),
    ],
  }

  it('lists lines sorted by group then name with normalised amounts', async () => {
    const { ctx } = fakeContext({ tables })
    const { lines } = await listBudgetLines(ctx, {})
    expect(lines.map((l) => l.name)).toEqual(['Meds', 'Rent', 'Gifts', 'Netflix'])
    expect(lines.find((l) => l.name === 'Rent')).toMatchObject({
      fortnightly_cents: 1_000_00,
      annual_cents: 26_000_00,
      derived: false,
    })
    expect(lines.find((l) => l.name === 'Netflix')).toMatchObject({
      annual_cents: 240_00,
      management_url: 'https://netflix.com',
    })
    expect(lines.find((l) => l.name === 'Meds')).toMatchObject({
      annual_cents: 1_300_00,
      derived: true,
    })
    expect(lines.find((l) => l.name === 'Gifts')?.derived).toBe(true)
  })

  it('reports the allowance a line is drawn from', async () => {
    const { ctx } = fakeContext({
      tables: {
        budget_line: [
          line({ name: 'Gym', line_group: 'discretionary', allowance_member_id: 'm1' }),
          line({ name: 'Rent' }),
        ],
      },
    })
    const { lines } = await listBudgetLines(ctx, {})
    expect(lines.map((l) => [l.name, l.allowance_member_id])).toEqual([
      ['Gym', 'm1'],
      ['Rent', null],
    ])
  })

  it('filters by a case-insensitive part of the name', async () => {
    const { ctx } = fakeContext({ tables })
    const { lines } = await listBudgetLines(ctx, { name: ' FLIX ' })
    expect(lines.map((l) => l.name)).toEqual(['Netflix'])
  })

  it('reports a failed read with fixed copy', async () => {
    const { ctx } = fakeContext()
    ctx.supabase.from = (() => ({
      select: () => Promise.resolve({ data: null, error: { message: 'upstream detail' } }),
    })) as never
    const error = await listBudgetLines(ctx, {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ToolError)
    expect((error as ToolError).code).toBe('query_failed')
    expect((error as ToolError).message).not.toContain('upstream')
  })
})

describe('listSavingsGoals', () => {
  const tables = {
    savings_goal: [
      {
        id: 'g1',
        name: 'Holiday',
        target_amount_cents: 10_000_00,
        current_balance_cents: 1_00,
        target_date: '2027-06-01',
        linked_account_id: 'acc',
        queue_position: null,
        annual_interest_bps: null,
        planned_contribution_cents: null,
      },
      {
        id: 'g2',
        name: 'Car',
        target_amount_cents: 20_000_00,
        current_balance_cents: 5_000_00,
        target_date: null,
        linked_account_id: 'hidden',
        queue_position: 0,
        annual_interest_bps: 450,
        planned_contribution_cents: null,
      },
      {
        id: 'g3',
        name: 'Bond',
        target_amount_cents: 0,
        current_balance_cents: 0,
        target_date: null,
        linked_account_id: null,
        queue_position: 1,
        annual_interest_bps: null,
        planned_contribution_cents: null,
      },
      {
        id: 'g4',
        name: 'Aaa',
        target_amount_cents: 1_000_00,
        current_balance_cents: 1_500_00,
        target_date: '2027-01-01',
        linked_account_id: null,
        queue_position: null,
        annual_interest_bps: null,
        planned_contribution_cents: null,
      },
      {
        id: 'g5',
        name: 'Zzz',
        target_amount_cents: 1_000_00,
        current_balance_cents: 0,
        target_date: '2027-01-01',
        linked_account_id: null,
        queue_position: null,
        annual_interest_bps: null,
        planned_contribution_cents: null,
      },
    ],
    accounts_with_balance: [
      { id: 'acc', source: 'up', type: 'savings', owner_member_id: null, balance_cents: 4_000_00 },
    ],
    budget_line: [line({ goal_id: 'g1' })],
  }

  it('uses a visible linked saver balance, else the goal balance, and orders dated goals first', async () => {
    const { ctx } = fakeContext({ tables })
    const result = await listSavingsGoals(ctx)
    expect(result.goals.map((g) => g.name)).toEqual(['Aaa', 'Zzz', 'Holiday', 'Bond', 'Car'])
  })

  it('reports progress, remaining, and status', async () => {
    const { ctx } = fakeContext({ tables })
    const result = await listSavingsGoals(ctx)
    const byName = Object.fromEntries(result.goals.map((g) => [g.name, g]))
    expect(byName.Holiday).toMatchObject({
      saved_cents: 4_000_00,
      progress_percent: 40,
      remaining_cents: 6_000_00,
      status: 'active',
    })
    expect(byName.Car).toMatchObject({
      saved_cents: 5_000_00,
      progress_percent: 25,
      status: 'queued',
    })
    expect(byName.Aaa).toMatchObject({ remaining_cents: 0, progress_percent: 150 })
    expect(byName.Bond?.progress_percent).toBeNull()
    expect(result.total_saved_cents).toBe(4_000_00 + 5_000_00 + 1_500_00)
    expect(result.total_target_cents).toBe(10_000_00 + 20_000_00 + 1_000_00 + 1_000_00)
  })
})

describe('listWishlist', () => {
  it('names the tagged member and totals the cost', async () => {
    const { ctx } = fakeContext({
      tables: {
        members,
        wishlist_item: [
          { id: 'w1', name: 'Bike', amount_cents: 1_000_00, member_id: 'm-other', note: null },
          { id: 'w2', name: 'Art', amount_cents: 200_00, member_id: null, note: 'Gallery' },
          { id: 'w3', name: 'Ghost', amount_cents: 1_00, member_id: 'gone', note: null },
        ],
      },
    })
    const result = await listWishlist(ctx)
    expect(result.items.map((i) => [i.name, i.member])).toEqual([
      ['Art', null],
      ['Bike', 'Sam'],
      ['Ghost', null],
    ])
    expect(result.total_cents).toBe(1_201_00)
  })
})

describe('getFortnightlyBuffer', () => {
  const inflow = {
    member_id: 'm1',
    taxable: true,
    attracts_super: true,
    type: 'salary',
    schedule: 'annual',
    interval_count: null,
    amount_cents: 120_000_00,
    hourly_rate_cents: null,
    hours_per_period: null,
    starts_on: null,
    ends_on: null,
    paid_on: null,
    one_off_tax_treatment: null,
    years_of_service: null,
    is_joint: false,
    member_split_percent: null,
  }
  const rows = {
    inflows: [inflow],
    tax_profile: [
      {
        member_id: 'm1',
        residency: 'resident',
        has_private_hospital_cover: false,
        financial_year: 2027,
      },
    ],
    members: [{ id: 'm1', name: 'Alex', date_of_birth: null }],
    budget_line: [line({ amount_cents: 500_00, frequency: 'fortnightly' })],
    savings_goal: [{ annual_interest_bps: 400, linked_account_id: 's1', current_balance_cents: 0 }],
    accounts_with_balance: [
      { id: 's1', source: 'up', type: 'savings', owner_member_id: 'm1', balance_cents: 10_000_00 },
      { id: 's2', source: 'up', type: 'transaction', owner_member_id: 'm1', balance_cents: null },
    ],
  }

  it('matches the shared summarise logic over the member-visible rows', async () => {
    const { ctx } = fakeContext({ tables: rows })
    const result = await getFortnightlyBuffer(ctx)
    const expected = summariseHouseholdFromRows(
      {
        inflows: rows.inflows,
        taxProfiles: rows.tax_profile,
        contributions: [],
        helpDebts: [],
        deductions: [],
        members: rows.members,
        budgetLines: rows.budget_line,
        memberAllowances: [],
        temporaryItems: [],
        savingsGoals: rows.savings_goal,
        savers: [{ id: 's1', owner_member_id: 'm1', balance_cents: 10_000_00 }],
      },
      ctx.now(),
    )
    expect(result.financial_year).toBe(2027)
    expect(result.fortnightly_buffer_cents).toBe(expected.afterSaving.fortnightlyCents)
    expect(result.annual_buffer_cents).toBe(expected.afterSaving.annualCents)
    expect(result.available_fortnightly_cents).toBe(expected.available.fortnightlyCents)
    expect(result.outgoings_fortnightly_cents).toBe(500_00)
    expect(result.groups_fortnightly_cents.needs).toBe(500_00)
    expect(Number.isInteger(result.fortnightly_buffer_cents)).toBe(true)
  })

  it('counts a member allowance once and reports it with what is drawn', async () => {
    const { ctx } = fakeContext({
      tables: {
        ...rows,
        budget_line: [
          line({
            line_group: 'discretionary',
            amount_cents: 60_00,
            frequency: 'fortnightly',
            allowance_member_id: 'm1',
          }),
        ],
        member_allowance: [
          { member_id: 'm1', amount_cents: 200_00, frequency: 'fortnightly', interval_count: null },
        ],
      },
    })
    const result = await getFortnightlyBuffer(ctx)
    expect(result.groups_fortnightly_cents.discretionary).toBe(200_00)
    expect(result.outgoings_fortnightly_cents).toBe(200_00)
    expect(result.allowances).toEqual([
      {
        member: 'Alex',
        member_id: 'm1',
        allowance_fortnightly_cents: 200_00,
        drawn_fortnightly_cents: 60_00,
        remaining_fortnightly_cents: 140_00,
        overdrawn: false,
      },
    ])
  })

  it('treats a saver with no visible balance as zero', async () => {
    const { ctx } = fakeContext({
      tables: {
        ...rows,
        accounts_with_balance: [
          { id: 's1', source: 'up', type: 'savings', owner_member_id: 'm1', balance_cents: null },
        ],
      },
    })
    const result = await getFortnightlyBuffer(ctx)
    expect(Number.isInteger(result.fortnightly_buffer_cents)).toBe(true)
  })
})
