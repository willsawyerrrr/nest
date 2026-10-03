import { describe, expect, it } from 'vitest'
import { makeBudgetLine } from '../test/fixtures'
import { resolveRoute } from './budgetLineRoute'

describe('resolveRoute', () => {
  it('names the allowance a line is drawn from instead of a funding account', () => {
    const line = makeBudgetLine({
      line_group: 'discretionary',
      allowance_member_id: 'm1',
      destination_account_id: null,
    })
    expect(resolveRoute(line, [], new Map(), new Map([['m1', 'Ada’s allowance']]))).toEqual({
      iconName: 'Ada’s allowance',
      label: 'Ada’s allowance',
      title: 'Drawn from Ada’s allowance',
      drawn: true,
    })
  })

  it('falls back to the funding account when the allowance is not known', () => {
    const line = makeBudgetLine({
      line_group: 'discretionary',
      allowance_member_id: 'm1',
      destination_account_id: 'a1',
    })
    expect(resolveRoute(line, [], new Map([['a1', 'Spending']]))).toMatchObject({
      title: 'Funded from Spending',
    })
  })
})
