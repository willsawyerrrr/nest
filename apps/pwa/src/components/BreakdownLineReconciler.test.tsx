import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BreakdownLineReconciler } from './BreakdownLineReconciler'

const createLine = vi.fn()
const updateLine = vi.fn()
const removeLine = vi.fn()

vi.mock('../hooks/useBudgetLines', () => ({
  useBudgetLines: () => ({
    lines: [],
    loading: false,
    create: createLine,
    update: updateLine,
    remove: removeLine,
  }),
}))

vi.mock('../hooks/useBreakdowns', () => ({
  useBreakdowns: () => ({
    breakdowns: [
      {
        id: 'bd1',
        household_id: 'h1',
        name: 'Meds',
        line_group: 'needs',
        kind: 'generic',
        created_at: '',
        updated_at: '',
      },
    ],
    items: [
      {
        id: 'i1',
        household_id: 'h1',
        breakdown_id: 'bd1',
        name: 'Item',
        amount_cents: 10_00,
        frequency: 'annual',
        interval_count: null,
        created_at: '',
        updated_at: '',
      },
    ],
    loading: false,
  }),
}))

vi.mock('../hooks/useGifts', () => ({
  useGifts: () => ({ budgets: [], recipients: [], loading: false }),
}))

vi.mock('../hooks/useMembers', () => ({
  useMembers: () => ({
    members: [
      { id: 'm-sam', household_id: 'h1', name: 'Sam' },
      { id: 'm-will', household_id: 'h1', name: 'Will' },
    ],
    loading: false,
  }),
}))

vi.mock('../hooks/useAccountDirectory', () => ({
  useAccountDirectory: () => ({
    accounts: [{ id: 'will-txn', owner_member_id: 'm-will', type: 'transaction' }],
    loading: false,
  }),
}))

const reconcileSpy = vi.fn()
vi.mock('../hooks/useReconcileBreakdownLines', () => ({
  useReconcileBreakdownLines: (params: unknown) => reconcileSpy(params),
}))

describe('BreakdownLineReconciler', () => {
  it('runs the reconcile with the derived-amount context, counts, members, and directory', () => {
    const { container } = render(<BreakdownLineReconciler householdId="h1" />)

    expect(container).toBeEmptyDOMElement()
    expect(reconcileSpy).toHaveBeenCalledTimes(1)
    const params = reconcileSpy.mock.calls[0]![0] as {
      dataLoaded: boolean
      context: { genericTotalsByBreakdownId: Map<string, number> }
      counts: Map<string, number>
      memberNames: Map<string, string>
      members: { id: string }[]
      directory: { id: string }[]
      createLine: unknown
    }
    expect(params.dataLoaded).toBe(true)
    expect(params.context.genericTotalsByBreakdownId.get('bd1')).toBe(10_00)
    expect(params.counts.get('bd1')).toBe(1)
    expect(params.memberNames.get('m-sam')).toBe('Sam')
    expect(params.members.map((member) => member.id)).toEqual(['m-sam', 'm-will'])
    expect(params.directory.map((account) => account.id)).toEqual(['will-txn'])
    expect(params.createLine).toBe(createLine)
  })
})
