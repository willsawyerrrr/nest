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
  useGifts: () => ({ budgets: [], loading: false }),
}))

const reconcileSpy = vi.fn()
vi.mock('../hooks/useReconcileBreakdownLines', () => ({
  useReconcileBreakdownLines: (params: unknown) => reconcileSpy(params),
}))

describe('BreakdownLineReconciler', () => {
  it('runs the reconcile with rolled-up totals and counts, with no route in scope', () => {
    const { container } = render(<BreakdownLineReconciler householdId="h1" />)

    expect(container).toBeEmptyDOMElement()
    expect(reconcileSpy).toHaveBeenCalledTimes(1)
    const params = reconcileSpy.mock.calls[0]![0] as {
      dataLoaded: boolean
      totals: Map<string, number>
      counts: Map<string, number>
      createLine: unknown
    }
    expect(params.dataLoaded).toBe(true)
    expect(params.totals.get('bd1')).toBe(10_00)
    expect(params.counts.get('bd1')).toBe(1)
    expect(params.createLine).toBe(createLine)
  })
})
