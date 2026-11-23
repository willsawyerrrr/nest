import { describe, expect, it } from 'vitest'
import {
  actualSpendByGroup,
  PAY_CYCLE_EPOCH,
  payCycleAnchor,
  spendFortnight,
} from './actualSpend.ts'

const inflow = (overrides: Partial<Parameters<typeof payCycleAnchor>[0][number]>) => ({
  type: 'salary',
  paid_on: null,
  pay_anchor_date: null,
  ...overrides,
})

describe('payCycleAnchor', () => {
  it('takes the earliest confirmed payday among recurring salary and wage inflows', () => {
    expect(
      payCycleAnchor([
        inflow({ pay_anchor_date: '2026-07-16' }),
        inflow({ type: 'wage', pay_anchor_date: '2026-07-09' }),
        inflow({ type: 'other', pay_anchor_date: '2026-01-01' }),
        inflow({ paid_on: '2026-01-02', pay_anchor_date: '2026-01-02' }),
      ]),
    ).toBe('2026-07-09')
  })

  it('falls back to the epoch with no confirmed payday', () => {
    expect(payCycleAnchor([inflow({})])).toBe(PAY_CYCLE_EPOCH)
  })
})

describe('spendFortnight', () => {
  it('opens on the anchor and runs fourteen inclusive days', () => {
    expect(spendFortnight('2026-11-12', '2026-11-12')).toEqual({
      periodStart: '2026-11-12',
      periodEnd: '2026-11-25',
    })
    expect(spendFortnight('2026-11-12', '2026-11-25').periodStart).toBe('2026-11-12')
    expect(spendFortnight('2026-11-12', '2026-11-26').periodStart).toBe('2026-11-26')
  })

  it('steps by whole fortnights either side of the anchor', () => {
    expect(spendFortnight('2026-11-12', '2026-11-20', -1)).toEqual({
      periodStart: '2026-10-29',
      periodEnd: '2026-11-11',
    })
    expect(spendFortnight('2026-11-12', '2026-11-11')).toEqual({
      periodStart: '2026-10-29',
      periodEnd: '2026-11-11',
    })
    expect(spendFortnight('2026-11-12', '2026-11-12', 2).periodStart).toBe('2026-12-10')
  })

  it('stays on the grid across a daylight-saving change', () => {
    expect(spendFortnight(PAY_CYCLE_EPOCH, '2026-10-05').periodStart).toBe('2026-09-30')
  })
})

describe('actualSpendByGroup', () => {
  it('folds the rows into every group and the unbudgeted rest', () => {
    expect(
      actualSpendByGroup([
        { line_group: 'needs', spent_cents: 250_00 },
        { line_group: 'wants', spent_cents: -5_00 },
        { line_group: null, spent_cents: 20_00 },
      ]),
    ).toEqual({
      groups: { needs: 250_00, wants: -5_00, discretionary: 0, savings: 0, investments: 0 },
      unbudgeted: 20_00,
    })
  })
})
