/* eslint-disable react/only-export-components -- the provider and its hook are one unit. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  clearPlanningMode,
  countPending,
  EMPTY_LAYER,
  INACTIVE_STATE,
  layerCreate,
  layerDelete,
  layerResetRow,
  layerUpdate,
  readPlanningMode,
  writePlanningMode,
  type PlanningLayer,
  type PlanningRow,
  type PlanningState,
  type PlanningTable,
} from '../lib/planningMode'

/** The planning-mode sandbox exposed to the app: its state, its controls, and its per-table mutators. */
export interface PlanningModeContextValue {
  /** Whether the sandbox is on. While on, the three cash-flow tables read and write it, not Postgres. */
  active: boolean
  /** Turns the sandbox on with an empty override layer. */
  enter: () => void
  /** Turns the sandbox off and discards every override for this household. */
  exit: () => void
  /** How many edits are pending across every table's layer. */
  pendingCount: number
  /** The override layer for one table, or `undefined` when it has no edits. */
  layerFor: (table: PlanningTable) => PlanningLayer | undefined
  /** Merges a field patch into a row's sandbox edits. */
  applyUpdate: (table: PlanningTable, id: string, patch: Record<string, unknown>) => void
  /** Adds a whole row to the sandbox. */
  applyCreate: (table: PlanningTable, row: PlanningRow) => void
  /** Hides a real row from the sandbox, or drops a sandbox-created one. */
  applyDelete: (table: PlanningTable, id: string) => void
  /** Removes every sandbox edit for one row, restoring its real value. */
  resetRow: (table: PlanningTable, id: string) => void
  /** Removes every sandbox edit while staying in planning mode. */
  resetAll: () => void
}

/** Planning off, every mutator a no-op — the value seen outside a provider. */
const INERT: PlanningModeContextValue = {
  active: false,
  enter: () => {},
  exit: () => {},
  pendingCount: 0,
  layerFor: () => undefined,
  applyUpdate: () => {},
  applyCreate: () => {},
  applyDelete: () => {},
  resetRow: () => {},
  resetAll: () => {},
}

const PlanningModeContext = createContext<PlanningModeContextValue>(INERT)

/**
 * The planning-mode sandbox for the code below. Outside a provider it returns
 * the inert value, so a component — or a test — that renders a collection hook
 * without the provider still works, with planning simply off.
 */
export function usePlanningMode(): PlanningModeContextValue {
  return useContext(PlanningModeContext)
}

/**
 * Holds the household's planning-mode sandbox in React state, seeded from and
 * persisted to localStorage. Mounted in `HouseholdApp` so every routed section
 * — and every collection hook it renders — sees the same sandbox.
 */
export function PlanningModeProvider({
  householdId,
  children,
}: PropsWithChildren<{ householdId: string }>) {
  const [state, setState] = useState<PlanningState>(() => readPlanningMode(householdId))

  // The mutators derive the next state from the last committed one; a ref keeps
  // that reachable without threading `state` through every callback's deps.
  const stateRef = useRef(state)
  stateRef.current = state

  // A different household keeps its own sandbox; load it when the id changes.
  useEffect(() => {
    const next = readPlanningMode(householdId)
    stateRef.current = next
    setState(next)
  }, [householdId])

  const commit = useCallback(
    (next: PlanningState) => {
      stateRef.current = next
      setState(next)
      writePlanningMode(householdId, next)
    },
    [householdId],
  )

  const mutateLayer = useCallback(
    (table: PlanningTable, fn: (layer: PlanningLayer) => PlanningLayer) => {
      const current = stateRef.current
      const layer = current.overrides[table] ?? EMPTY_LAYER
      commit({ ...current, overrides: { ...current.overrides, [table]: fn(layer) } })
    },
    [commit],
  )

  const value = useMemo<PlanningModeContextValue>(
    () => ({
      active: state.active,
      pendingCount: countPending(state.overrides),
      layerFor: (table) => state.overrides[table],
      enter: () => commit({ active: true, overrides: {} }),
      exit: () => {
        clearPlanningMode(householdId)
        stateRef.current = INACTIVE_STATE
        setState(INACTIVE_STATE)
      },
      resetAll: () => commit({ active: state.active, overrides: {} }),
      applyUpdate: (table, id, patch) =>
        mutateLayer(table, (layer) => layerUpdate(layer, id, patch)),
      applyCreate: (table, row) => mutateLayer(table, (layer) => layerCreate(layer, row)),
      applyDelete: (table, id) => mutateLayer(table, (layer) => layerDelete(layer, id)),
      resetRow: (table, id) => mutateLayer(table, (layer) => layerResetRow(layer, id)),
    }),
    [state, commit, mutateLayer, householdId],
  )

  return <PlanningModeContext.Provider value={value}>{children}</PlanningModeContext.Provider>
}
