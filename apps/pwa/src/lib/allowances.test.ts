import { describe, expect, it } from 'vitest'
import { makeBudgetLine, makeMemberAllowance } from '../test/fixtures'
import {
  allowanceChoices,
  allowanceName,
  isAllowanceOverdrawn,
  toAssignableAllowances,
  toPlanAllowance,
  toPlanDrawableLine,
} from './allowances'

describe('allowanceName', () => {
  it('possessively names a member’s allowance', () => {
    expect(allowanceName('Ada')).toBe('Ada’s allowance')
  })
})

describe('toPlanAllowance', () => {
  it('maps a row to the plan’s shape, carrying an interval only when set', () => {
    expect(toPlanAllowance(makeMemberAllowance())).toEqual({
      memberId: 'm1',
      amountCents: 200_00,
      frequency: 'fortnightly',
    })
    expect(
      toPlanAllowance(makeMemberAllowance({ frequency: 'every_n_weeks', interval_count: 3 })),
    ).toMatchObject({ frequency: 'every_n_weeks', interval: 3 })
  })
})

describe('toPlanDrawableLine', () => {
  it('carries the allowance a line is drawn from', () => {
    expect(
      toPlanDrawableLine(makeBudgetLine({ amount_cents: 40_00, allowance_member_id: 'm1' })),
    ).toEqual({
      amountCents: 40_00,
      frequency: 'fortnightly',
      allowanceMemberId: 'm1',
    })
  })
})

describe('toAssignableAllowances', () => {
  it('names each allowance and carries its funding account, skipping unknown members', () => {
    const rows = [
      makeMemberAllowance({ destination_account_id: 'acct' }),
      makeMemberAllowance({ id: 'al2', member_id: 'gone' }),
    ]
    expect(toAssignableAllowances(rows, [{ id: 'm1', name: 'Ada' }])).toEqual([
      {
        memberId: 'm1',
        amountCents: 200_00,
        frequency: 'fortnightly',
        name: 'Ada’s allowance',
        destinationAccountId: 'acct',
      },
    ])
  })
})

describe('isAllowanceOverdrawn', () => {
  it('recognises only the database’s allowance refusal', () => {
    expect(isAllowanceOverdrawn({ message: 'allowance_overdrawn' })).toBe(true)
    expect(isAllowanceOverdrawn({ message: 'something else' })).toBe(false)
    expect(isAllowanceOverdrawn(new Error('allowance_overdrawn'))).toBe(true)
    expect(isAllowanceOverdrawn('allowance_overdrawn')).toBe(false)
    expect(isAllowanceOverdrawn(null)).toBe(false)
    expect(isAllowanceOverdrawn({})).toBe(false)
  })
})

describe('allowanceChoices', () => {
  const allowances = [
    { name: 'Ada’s allowance', allowance: toPlanAllowance(makeMemberAllowance()) },
    {
      name: 'Bob’s allowance',
      allowance: toPlanAllowance(makeMemberAllowance({ id: 'al2', member_id: 'm2' })),
    },
  ]

  it('offers only the member’s own allowance, with the annual amount still undrawn', () => {
    const lines = [
      makeBudgetLine({ amount_cents: 60_00, allowance_member_id: 'm1' }),
      makeBudgetLine({ amount_cents: 999_00, allowance_member_id: null }),
    ]
    expect(allowanceChoices(allowances, lines, 'm1')).toEqual([
      { memberId: 'm1', name: 'Ada’s allowance', remainingAnnualCents: 5_200_00 - 60_00 * 26 },
    ])
  })

  it('offers nothing to a signed-out member', () => {
    expect(allowanceChoices(allowances, [], null)).toEqual([])
  })
})
