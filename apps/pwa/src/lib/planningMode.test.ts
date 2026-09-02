import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyOverrides,
  clearPlanningMode,
  countPending,
  EMPTY_LAYER,
  INACTIVE_STATE,
  isPlanningTable,
  layerCreate,
  layerDelete,
  layerResetRow,
  layerUpdate,
  planningStorageKey,
  readPlanningMode,
  writePlanningMode,
  type PlanningLayer,
} from './planningMode'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const layer = (over: Partial<PlanningLayer> = {}): PlanningLayer => ({ ...EMPTY_LAYER, ...over })

describe('isPlanningTable', () => {
  it('recognises the three sandboxed tables and nothing else', () => {
    expect(isPlanningTable('inflows')).toBe(true)
    expect(isPlanningTable('budget_line')).toBe(true)
    expect(isPlanningTable('savings_goal')).toBe(true)
    expect(isPlanningTable('temporary_item')).toBe(false)
  })
})

describe('planningStorageKey', () => {
  it('namespaces by household id', () => {
    expect(planningStorageKey('h1')).toBe('planning-mode:h1')
  })
})

describe('readPlanningMode / writePlanningMode', () => {
  it('returns the inactive state when nothing is stored', () => {
    expect(readPlanningMode('h1')).toEqual(INACTIVE_STATE)
  })

  it('round-trips an active sandbox', () => {
    const state = {
      active: true,
      overrides: {
        inflows: { updates: { a: { amount_cents: 10 } }, creates: [{ id: 'n1' }], deletes: ['d1'] },
      },
    }
    writePlanningMode('h1', state)
    expect(readPlanningMode('h1')).toEqual(state)
  })

  it('scopes storage per household', () => {
    writePlanningMode('h1', { active: true, overrides: {} })
    expect(readPlanningMode('h2')).toEqual(INACTIVE_STATE)
  })

  it('reads a stored inactive flag as inactive', () => {
    localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ overrides: {} }))
    expect(readPlanningMode('h1').active).toBe(false)
  })

  it('reads a blob with no overrides key as an empty override map', () => {
    localStorage.setItem(planningStorageKey('h1'), JSON.stringify({ active: true }))
    expect(readPlanningMode('h1')).toEqual({ active: true, overrides: {} })
  })

  it('drops malformed parts rather than failing the whole read', () => {
    localStorage.setItem(
      planningStorageKey('h1'),
      JSON.stringify({
        active: true,
        overrides: {
          inflows: {
            updates: { a: { x: 1 }, b: null, c: 5 },
            creates: [{ id: 'ok' }, { id: 5 }, null, 'nope'],
            deletes: ['d1', 7],
          },
          not_a_table: { updates: {}, creates: [], deletes: [] },
          budget_line: 'garbage',
          savings_goal: null,
        },
      }),
    )
    expect(readPlanningMode('h1')).toEqual({
      active: true,
      overrides: {
        inflows: { updates: { a: { x: 1 } }, creates: [{ id: 'ok' }], deletes: ['d1'] },
        budget_line: { updates: {}, creates: [], deletes: [] },
        savings_goal: { updates: {}, creates: [], deletes: [] },
      },
    })
  })

  it('falls back to the inactive state on unparseable storage', () => {
    localStorage.setItem(planningStorageKey('h1'), '{not json')
    expect(readPlanningMode('h1')).toEqual(INACTIVE_STATE)
  })

  it('falls back to the inactive state when localStorage throws on read', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readPlanningMode('h1')).toEqual(INACTIVE_STATE)
  })

  it('swallows a write failure', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => writePlanningMode('h1', { active: true, overrides: {} })).not.toThrow()
  })
})

describe('clearPlanningMode', () => {
  it('removes a household sandbox', () => {
    writePlanningMode('h1', { active: true, overrides: {} })
    clearPlanningMode('h1')
    expect(readPlanningMode('h1')).toEqual(INACTIVE_STATE)
  })

  it('swallows a removal failure', () => {
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => clearPlanningMode('h1')).not.toThrow()
  })
})

describe('applyOverrides', () => {
  const rows = [
    { id: 'a', amount: 1 },
    { id: 'b', amount: 2 },
  ]

  it('returns a copy of the rows when there is no layer', () => {
    const out = applyOverrides(rows, undefined)
    expect(out).toEqual(rows)
    expect(out).not.toBe(rows)
  })

  it('drops deletes, merges updates by id, and appends creates', () => {
    const out = applyOverrides(
      rows,
      layer({
        updates: { a: { amount: 99 }, n1: { amount: 7 } },
        creates: [{ id: 'n1', amount: 0 }],
        deletes: ['b'],
      }),
    )
    expect(out).toEqual([
      { id: 'a', amount: 99 },
      { id: 'n1', amount: 7 },
    ])
  })

  it('drops a create that was later deleted', () => {
    const out = applyOverrides(rows, layer({ creates: [{ id: 'n1', amount: 0 }], deletes: ['n1'] }))
    expect(out.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('leaves an unpatched create untouched', () => {
    const out = applyOverrides([], layer({ creates: [{ id: 'n1', amount: 3 }] }))
    expect(out).toEqual([{ id: 'n1', amount: 3 }])
  })
})

describe('countPending', () => {
  it('is zero with no overrides', () => {
    expect(countPending({})).toBe(0)
  })

  it('sums updates, creates, and deletes across tables', () => {
    expect(
      countPending({
        inflows: { updates: { a: {}, b: {} }, creates: [{ id: 'n' }], deletes: [] },
        savings_goal: { updates: {}, creates: [], deletes: ['x'] },
      }),
    ).toBe(4)
  })
})

describe('layer mutators', () => {
  it('layerUpdate merges a patch, seeding a row with no prior patch', () => {
    const once = layerUpdate(EMPTY_LAYER, 'a', { x: 1 })
    expect(once.updates).toEqual({ a: { x: 1 } })
    const twice = layerUpdate(once, 'a', { y: 2 })
    expect(twice.updates).toEqual({ a: { x: 1, y: 2 } })
  })

  it('layerCreate appends a row', () => {
    expect(layerCreate(EMPTY_LAYER, { id: 'n1' }).creates).toEqual([{ id: 'n1' }])
  })

  it('layerDelete drops a sandbox-created row without recording a delete', () => {
    const created = layerCreate(layerUpdate(EMPTY_LAYER, 'n1', { x: 1 }), { id: 'n1' })
    const out = layerDelete(created, 'n1')
    expect(out).toEqual({ updates: {}, creates: [], deletes: [] })
  })

  it('layerDelete records a real row and discards its patch', () => {
    const out = layerDelete(layerUpdate(EMPTY_LAYER, 'a', { x: 1 }), 'a')
    expect(out).toEqual({ updates: {}, creates: [], deletes: ['a'] })
  })

  it('layerDelete does not record the same real row twice', () => {
    const out = layerDelete(layer({ deletes: ['a'] }), 'a')
    expect(out.deletes).toEqual(['a'])
  })

  it('layerResetRow removes a row from every part of the layer', () => {
    const start = layer({
      updates: { a: { x: 1 }, b: { y: 2 } },
      creates: [{ id: 'a' }, { id: 'c' }],
      deletes: ['a', 'd'],
    })
    expect(layerResetRow(start, 'a')).toEqual({
      updates: { b: { y: 2 } },
      creates: [{ id: 'c' }],
      deletes: ['d'],
    })
  })
})
