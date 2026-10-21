import { describe, expect, it } from 'vitest'
import { ToolError } from '../errors.ts'
import { fakeContext, members } from '../test/fakeContext.ts'
import { addInflow, deleteInflow, listInflows, updateInflow } from './inflows.ts'

const ID = '8f14e45f-ceea-4d7a-8f4e-6c1f3f6b2a10'

const salary = {
  id: ID,
  household_id: 'h-1',
  name: 'Salary',
  taxable: true,
  member_id: 'm-self',
  type: 'salary',
  attracts_super: true,
  schedule: 'annual',
  interval_count: null,
  paid_on: null,
  one_off_tax_treatment: null,
  years_of_service: null,
  pay_schedule: 'fortnightly',
  pay_interval_count: null,
  arrives_every_pay_period: true,
  amount_cents: 130_000_00,
  hourly_rate_cents: null,
  hours_per_period: null,
  starts_on: null,
  ends_on: null,
  pay_anchor_date: null,
  is_joint: false,
  member_split_percent: null,
}

const bonus = {
  ...salary,
  name: 'Bonus',
  schedule: null,
  pay_schedule: null,
  paid_on: '2026-12-01',
  one_off_tax_treatment: 'ordinary',
}

async function failure(run: Promise<unknown>): Promise<ToolError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ToolError)
  return error as ToolError
}

const base = { name: 'Pay', type: 'salary', member: 'Alex', amount_cents: 1_000_00 } as const

describe('listInflows', () => {
  it('annualises recurring inflows, leaves one-offs null, and filters by name', async () => {
    const { ctx } = fakeContext({ tables: { inflows: [salary, bonus], members } })
    const all = await listInflows(ctx, {})
    expect(
      all.inflows.map((inflow) => [inflow.name, inflow.recurrence, inflow.annual_cents]),
    ).toEqual([
      ['Bonus', 'one_off', null],
      ['Salary', 'recurring', 130_000_00],
    ])
    expect(all.inflows[1]?.member).toBe('Alex')
    expect((await listInflows(ctx, { name: 'sal' })).inflows).toHaveLength(1)
  })

  it('annualises a wage from its rate and hours', async () => {
    const wage = {
      ...salary,
      type: 'wage',
      amount_cents: null,
      schedule: 'weekly',
      hourly_rate_cents: 50_00,
      hours_per_period: '10.00',
    }
    const { ctx } = fakeContext({ tables: { inflows: [wage], members } })
    expect((await listInflows(ctx, {})).inflows[0]).toMatchObject({
      annual_cents: 26_000_00,
      hours_per_period: 10,
    })
  })
})

describe('addInflow', () => {
  it('inserts a recurring salary with the amount and pay cadence stated separately', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addInflow(ctx, { ...base, schedule: 'annual', pay_schedule: 'fortnightly' })
    expect(state.inserts).toEqual([
      {
        table: 'inflows',
        row: {
          household_id: 'h-1',
          name: 'Pay',
          taxable: true,
          member_id: 'm-self',
          type: 'salary',
          attracts_super: true,
          amount_cents: 1_000_00,
          hourly_rate_cents: null,
          hours_per_period: null,
          is_joint: false,
          member_split_percent: null,
          schedule: 'annual',
          interval_count: null,
          paid_on: null,
          one_off_tax_treatment: null,
          years_of_service: null,
          pay_schedule: 'fortnightly',
          pay_interval_count: null,
          arrives_every_pay_period: true,
          starts_on: null,
          ends_on: null,
          pay_anchor_date: null,
        },
      },
    ])
  })

  it('adds a wage priced by rate and hours', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addInflow(ctx, {
      name: 'Casual',
      type: 'wage',
      member: 'Sam',
      schedule: 'weekly',
      hourly_rate_cents: 40_00,
      hours_per_period: 12.5,
    })
    expect(state.inserts[0]?.row).toMatchObject({
      member_id: 'm-other',
      amount_cents: null,
      hourly_rate_cents: 40_00,
      hours_per_period: 12.5,
    })
    expect(
      (
        await failure(
          addInflow(ctx, { name: 'W', type: 'wage', member: 'Sam', schedule: 'weekly' }),
        )
      ).code,
    ).toBe('invalid_details')
    expect(
      (
        await failure(
          addInflow(ctx, {
            ...base,
            type: 'wage',
            schedule: 'weekly',
            hourly_rate_cents: 1,
            hours_per_period: 1,
          }),
        )
      ).code,
    ).toBe('invalid_details')
  })

  it('adds a taxable one-off with its tax treatment and no cadence', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addInflow(ctx, {
      ...base,
      paid_on: '2026-12-01',
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 7,
    })
    expect(state.inserts[0]?.row).toMatchObject({
      schedule: null,
      paid_on: '2026-12-01',
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 7,
      arrives_every_pay_period: true,
      starts_on: null,
    })
  })

  it('defaults a taxable one-off to ordinary and a non-taxable one to no treatment', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addInflow(ctx, { ...base, paid_on: '2026-12-01' })
    await addInflow(ctx, {
      name: 'Gift',
      type: 'gift',
      taxable: false,
      amount_cents: 5_00,
      paid_on: '2026-12-01',
    })
    expect(state.inserts[0]?.row).toMatchObject({
      one_off_tax_treatment: 'ordinary',
      years_of_service: null,
    })
    expect(state.inserts[1]?.row).toMatchObject({
      taxable: false,
      member_id: null,
      one_off_tax_treatment: null,
    })
  })

  it('requires exactly one of schedule and paid_on', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    expect((await failure(addInflow(ctx, base))).code).toBe('invalid_details')
    expect(
      (await failure(addInflow(ctx, { ...base, schedule: 'weekly', paid_on: '2026-12-01' }))).code,
    ).toBe('invalid_details')
  })

  it('refuses cadence fields, a wage, and a missing redundancy length on a one-off', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    const oneOff = { ...base, paid_on: '2026-12-01' } as const
    for (const extra of [
      { starts_on: '2026-07-01' },
      { pay_schedule: 'weekly' },
      { arrives_every_pay_period: false },
      { interval_count: 2 },
      { type: 'wage' },
      { one_off_tax_treatment: 'genuine_redundancy' },
      { one_off_tax_treatment: 'ordinary', years_of_service: 3 },
    ] as const) {
      expect((await failure(addInflow(ctx, { ...oneOff, ...extra }))).code).toBe('invalid_details')
    }
  })

  it('refuses one-off treatment on a recurring inflow', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    expect(
      (
        await failure(
          addInflow(ctx, { ...base, schedule: 'weekly', one_off_tax_treatment: 'ordinary' }),
        )
      ).code,
    ).toBe('invalid_details')
  })

  it('holds a taxable inflow to a member and the type to the taxability', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    const { member: _member, ...noMember } = base
    expect((await failure(addInflow(ctx, { ...noMember, schedule: 'weekly' }))).code).toBe(
      'invalid_details',
    )
    expect(
      (await failure(addInflow(ctx, { ...base, type: 'gift', schedule: 'weekly' }))).code,
    ).toBe('invalid_details')
    expect(
      (await failure(addInflow(ctx, { ...base, taxable: false, type: 'gift', schedule: 'weekly' })))
        .code,
    ).toBe('invalid_details')
    expect(
      (await failure(addInflow(ctx, { ...base, member: 'Nobody', schedule: 'weekly' }))).code,
    ).toBe('not_found')
  })

  it('requires an interval count for an every-N schedule or pay cadence, and only for those', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    const recurring = { ...base, schedule: 'every_n_weeks' } as const
    expect((await failure(addInflow(ctx, recurring))).code).toBe('invalid_details')
    expect(
      (await failure(addInflow(ctx, { ...base, schedule: 'weekly', interval_count: 2 }))).code,
    ).toBe('invalid_details')
    expect(
      (
        await failure(
          addInflow(ctx, { ...base, schedule: 'annual', pay_schedule: 'every_n_months' }),
        )
      ).code,
    ).toBe('invalid_details')
    expect(
      (await failure(addInflow(ctx, { ...base, schedule: 'annual', pay_interval_count: 3 }))).code,
    ).toBe('invalid_details')
    await expect(
      addInflow(ctx, {
        ...recurring,
        interval_count: 3,
        pay_schedule: 'every_n_months',
        pay_interval_count: 2,
      }),
    ).resolves.toMatchObject({ interval_count: 3, pay_interval_count: 2 })
  })

  it('rejects an effective window that ends before it starts', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    expect(
      (
        await failure(
          addInflow(ctx, {
            ...base,
            schedule: 'weekly',
            starts_on: '2026-08-01',
            ends_on: '2026-07-01',
          }),
        )
      ).code,
    ).toBe('invalid_details')
  })

  it('records the on-call flags', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    await addInflow(ctx, {
      ...base,
      schedule: 'fortnightly',
      attracts_super: false,
      arrives_every_pay_period: false,
      pay_anchor_date: '2026-10-09',
    })
    expect(state.inserts[0]?.row).toMatchObject({
      attracts_super: false,
      arrives_every_pay_period: false,
      pay_anchor_date: '2026-10-09',
    })
  })

  it('adds a joint other inflow with its split, and refuses a joint salary or a missing split', async () => {
    const { ctx, state } = fakeContext({ tables: { members } })
    const joint = { ...base, type: 'other', schedule: 'annual', is_joint: true } as const
    await addInflow(ctx, { ...joint, member_split_percent: 60 })
    expect(state.inserts[0]?.row).toMatchObject({ is_joint: true, member_split_percent: 60 })
    expect((await failure(addInflow(ctx, joint))).code).toBe('invalid_details')
    expect(
      (await failure(addInflow(ctx, { ...joint, type: 'salary', member_split_percent: 50 }))).code,
    ).toBe('invalid_details')
    expect(
      (
        await failure(
          addInflow(ctx, { ...base, type: 'other', schedule: 'annual', member_split_percent: 50 }),
        )
      ).code,
    ).toBe('invalid_details')
  })

  it('reports a failed insert with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { members }, insertError: true })
    const error = await failure(addInflow(ctx, { ...base, schedule: 'weekly' }))
    expect(error.code).toBe('save_failed')
    expect(error.message).not.toContain('upstream')
  })
})

describe('updateInflow', () => {
  it('changes only the given fields', async () => {
    const { ctx, state } = fakeContext({ tables: { inflows: [salary], members } })
    await updateInflow(ctx, { id: ID, amount_cents: 140_000_00 })
    expect(state.updates).toHaveLength(1)
    const { id: _id, household_id: _household, ...columns } = salary
    expect(state.updates[0]).toMatchObject({
      table: 'inflows',
      row: { ...columns, amount_cents: 140_000_00 },
      filters: [
        ['id', ID],
        ['household_id', 'h-1'],
      ],
    })
  })

  it('clears the pay cadence and effective dates with null', async () => {
    const { ctx, state } = fakeContext({
      tables: {
        inflows: [{ ...salary, starts_on: '2026-07-01', pay_anchor_date: '2026-10-09' }],
        members,
      },
    })
    await updateInflow(ctx, { id: ID, pay_schedule: null, starts_on: null, pay_anchor_date: null })
    expect(state.updates[0]?.row).toMatchObject({
      pay_schedule: null,
      starts_on: null,
      pay_anchor_date: null,
    })
  })

  it('turns a recurring inflow into a one-off, dropping its cadence', async () => {
    const { ctx, state } = fakeContext({ tables: { inflows: [salary], members } })
    await updateInflow(ctx, { id: ID, paid_on: '2026-12-01' })
    expect(state.updates[0]?.row).toMatchObject({
      schedule: null,
      pay_schedule: null,
      paid_on: '2026-12-01',
      one_off_tax_treatment: 'ordinary',
    })
  })

  it('turns a one-off into a recurring inflow, dropping its treatment', async () => {
    const { ctx, state } = fakeContext({ tables: { inflows: [bonus], members } })
    await updateInflow(ctx, { id: ID, schedule: 'monthly' })
    expect(state.updates[0]?.row).toMatchObject({
      schedule: 'monthly',
      paid_on: null,
      one_off_tax_treatment: null,
      years_of_service: null,
    })
  })

  it('drops the years of service when the treatment is no longer a redundancy', async () => {
    const redundancy = {
      ...bonus,
      one_off_tax_treatment: 'genuine_redundancy',
      years_of_service: 4,
    }
    const { ctx, state } = fakeContext({ tables: { inflows: [redundancy], members } })
    await updateInflow(ctx, { id: ID, one_off_tax_treatment: 'unused_leave' })
    expect(state.updates[0]?.row).toMatchObject({
      one_off_tax_treatment: 'unused_leave',
      years_of_service: null,
    })
  })

  it('drops the member when an inflow becomes non-taxable and refuses a member then', async () => {
    const { ctx, state } = fakeContext({ tables: { inflows: [salary], members } })
    await updateInflow(ctx, { id: ID, taxable: false, type: 'reimbursement' })
    expect(state.updates[0]?.row).toMatchObject({
      taxable: false,
      member_id: null,
      type: 'reimbursement',
    })
    expect(
      (await failure(updateInflow(ctx, { id: ID, taxable: false, type: 'gift', member: 'Alex' })))
        .code,
    ).toBe('invalid_details')
  })

  it('re-resolves the interval when the schedule changes', async () => {
    const { ctx } = fakeContext({ tables: { inflows: [salary], members } })
    expect((await failure(updateInflow(ctx, { id: ID, schedule: 'every_n_weeks' }))).code).toBe(
      'invalid_details',
    )
  })

  it('turns a joint inflow ordinary when it becomes a salary', async () => {
    const joint = { ...salary, type: 'other', is_joint: true, member_split_percent: 50 }
    const { ctx, state } = fakeContext({ tables: { inflows: [joint], members } })
    await updateInflow(ctx, { id: ID, type: 'salary' })
    expect(state.updates[0]?.row).toMatchObject({ is_joint: false, member_split_percent: null })
    expect(
      (await failure(updateInflow(ctx, { id: ID, type: 'salary', is_joint: true }))).code,
    ).toBe('invalid_details')
  })

  it('reports an unknown inflow as not found', async () => {
    const { ctx } = fakeContext({ tables: { members } })
    expect((await failure(updateInflow(ctx, { id: ID, name: 'X' }))).code).toBe('not_found')
  })

  it('reports a failed update with fixed copy', async () => {
    const { ctx } = fakeContext({ tables: { inflows: [salary], members }, updateError: true })
    expect((await failure(updateInflow(ctx, { id: ID, name: 'X' }))).code).toBe('save_failed')
  })
})

describe('deleteInflow', () => {
  it('deletes by id within the household', async () => {
    const { ctx, state } = fakeContext({ tables: { inflows: [salary] } })
    await expect(deleteInflow(ctx, { id: ID })).resolves.toEqual({ id: ID, deleted: true })
    expect(state.deletes).toEqual([
      {
        table: 'inflows',
        filters: [
          ['id', ID],
          ['household_id', 'h-1'],
        ],
      },
    ])
  })

  it('reports an unknown inflow as not found and a failure with fixed copy', async () => {
    expect((await failure(deleteInflow(fakeContext().ctx, { id: ID }))).code).toBe('not_found')
    const { ctx } = fakeContext({ tables: { inflows: [salary] }, deleteError: true })
    expect((await failure(deleteInflow(ctx, { id: ID }))).code).toBe('save_failed')
  })
})
