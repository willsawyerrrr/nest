import { afterEach, describe, expect, it, vi } from 'vitest'
import { planningStorageKey, readPlanningMode } from '../lib/planningMode'
import { act, render } from '../test/render'
import {
  PlanningModeProvider,
  usePlanningMode,
  type PlanningModeContextValue,
} from './PlanningModeProvider'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

/** Mounts the provider and hands back a live view of the context value. */
function mount(householdId = 'h1') {
  let api: PlanningModeContextValue | undefined
  function Grab() {
    api = usePlanningMode()
    return null
  }
  const utils = render(
    <PlanningModeProvider householdId={householdId}>
      <Grab />
    </PlanningModeProvider>,
  )
  return {
    get: () => api as PlanningModeContextValue,
    rerender: (nextId: string) =>
      utils.rerender(
        <PlanningModeProvider householdId={nextId}>
          <Grab />
        </PlanningModeProvider>,
      ),
  }
}

describe('usePlanningMode outside a provider', () => {
  it('returns an inert value whose mutators are safe no-ops', () => {
    let api: PlanningModeContextValue | undefined
    function Grab() {
      api = usePlanningMode()
      return null
    }
    render(<Grab />)
    const inert = api as PlanningModeContextValue
    expect(inert.active).toBe(false)
    expect(inert.pendingCount).toBe(0)
    expect(inert.layerFor('inflows')).toBeUndefined()
    expect(() => {
      inert.enter()
      inert.exit()
      inert.applyUpdate('inflows', 'a', { x: 1 })
      inert.applyCreate('inflows', { id: 'n' })
      inert.applyDelete('inflows', 'a')
      inert.resetRow('inflows', 'a')
      inert.resetAll()
    }).not.toThrow()
  })
})

describe('PlanningModeProvider', () => {
  it('starts inactive and enters, persisting the flag', () => {
    const view = mount()
    expect(view.get().active).toBe(false)

    act(() => view.get().enter())

    expect(view.get().active).toBe(true)
    expect(readPlanningMode('h1').active).toBe(true)
  })

  it('records per-table edits and counts them', () => {
    const view = mount()
    act(() => view.get().enter())

    act(() => view.get().applyUpdate('inflows', 'a', { amount_cents: 10 }))
    act(() => view.get().applyCreate('budget_line', { id: 'n1', name: 'New' }))
    act(() => view.get().applyDelete('savings_goal', 'g1'))

    expect(view.get().layerFor('inflows')).toEqual({
      updates: { a: { amount_cents: 10 } },
      creates: [],
      deletes: [],
    })
    expect(view.get().pendingCount).toBe(3)
    expect(readPlanningMode('h1').overrides.budget_line?.creates).toEqual([
      { id: 'n1', name: 'New' },
    ])
  })

  it('resets one row and resets all while staying active', () => {
    const view = mount()
    act(() => view.get().enter())
    act(() => view.get().applyUpdate('inflows', 'a', { amount_cents: 10 }))
    act(() => view.get().applyUpdate('inflows', 'b', { amount_cents: 20 }))

    act(() => view.get().resetRow('inflows', 'a'))
    expect(view.get().layerFor('inflows')?.updates).toEqual({ b: { amount_cents: 20 } })

    act(() => view.get().resetAll())
    expect(view.get().active).toBe(true)
    expect(view.get().pendingCount).toBe(0)
  })

  it('exits, clearing the stored sandbox', () => {
    const view = mount()
    act(() => view.get().enter())
    act(() => view.get().applyUpdate('inflows', 'a', { amount_cents: 10 }))

    act(() => view.get().exit())

    expect(view.get().active).toBe(false)
    expect(view.get().pendingCount).toBe(0)
    expect(localStorage.getItem(planningStorageKey('h1'))).toBeNull()
  })

  it('seeds its state from a sandbox already in storage', () => {
    localStorage.setItem(
      planningStorageKey('h1'),
      JSON.stringify({
        active: true,
        overrides: { inflows: { updates: { a: { amount_cents: 1 } }, creates: [], deletes: [] } },
      }),
    )
    const view = mount()
    expect(view.get().active).toBe(true)
    expect(view.get().pendingCount).toBe(1)
  })

  it('loads the new household sandbox when the id changes', () => {
    localStorage.setItem(planningStorageKey('h2'), JSON.stringify({ active: true, overrides: {} }))
    const view = mount('h1')
    expect(view.get().active).toBe(false)

    act(() => view.rerender('h2'))

    expect(view.get().active).toBe(true)
  })
})
