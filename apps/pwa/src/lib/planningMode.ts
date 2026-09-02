/**
 * The client-side planning-mode sandbox: a per-device, per-household override
 * layer over the cash-flow tables. When planning mode is active every edit to
 * an inflow, a manual budget line, or a savings goal is held here rather than
 * written to Postgres, so the household can watch every projection recompute
 * and then discard the lot by leaving planning mode.
 *
 * This module is the storage and merge core. It follows `retirement.ts`'s
 * JSON-in-localStorage shape — plain read/write helpers, every access wrapped
 * so a private-mode browser that throws on `localStorage` still works.
 */

/** The tables planning mode sandboxes; every other table keeps writing real data. */
export const PLANNING_TABLES = ['inflows', 'budget_line', 'savings_goal'] as const

/** One of the three sandboxed tables. */
export type PlanningTable = (typeof PLANNING_TABLES)[number]

/** A row keyed by a string `id`, as every household collection row is. */
export type PlanningRow = { id: string } & Record<string, unknown>

/**
 * One table's pending sandbox edits: field patches keyed by row id, whole rows
 * created in the sandbox, and the ids of real rows hidden from it.
 */
export interface PlanningLayer {
  updates: Record<string, Record<string, unknown>>
  creates: PlanningRow[]
  deletes: string[]
}

/** The whole sandbox for one household: whether it is on, and the per-table edits. */
export interface PlanningState {
  active: boolean
  overrides: Partial<Record<PlanningTable, PlanningLayer>>
}

/** An empty layer — no updates, no creates, no deletes. */
export const EMPTY_LAYER: PlanningLayer = { updates: {}, creates: [], deletes: [] }

/** The state of a household that has never entered planning mode. */
export const INACTIVE_STATE: PlanningState = { active: false, overrides: {} }

const STORAGE_PREFIX = 'planning-mode:'

/** The localStorage key holding one household's sandbox. */
export function planningStorageKey(householdId: string): string {
  return `${STORAGE_PREFIX}${householdId}`
}

/** Whether `table` is one of the three planning mode sandboxes. */
export function isPlanningTable(table: string): table is PlanningTable {
  return (PLANNING_TABLES as readonly string[]).includes(table)
}

/** Coerces one stored layer to a complete `PlanningLayer`, dropping malformed parts. */
function sanitiseLayer(raw: unknown): PlanningLayer {
  const layer = (raw ?? {}) as Partial<PlanningLayer>
  const updates: Record<string, Record<string, unknown>> = {}
  for (const [id, patch] of Object.entries(layer.updates ?? {})) {
    if (patch && typeof patch === 'object') {
      updates[id] = patch as Record<string, unknown>
    }
  }
  const creates = Array.isArray(layer.creates)
    ? layer.creates.filter(
        (row): row is PlanningRow =>
          Boolean(row) && typeof row === 'object' && typeof (row as PlanningRow).id === 'string',
      )
    : []
  const deletes = Array.isArray(layer.deletes)
    ? layer.deletes.filter((id): id is string => typeof id === 'string')
    : []
  return { updates, creates, deletes }
}

/** Coerces the stored overrides map to whitelisted tables with complete layers. */
function sanitiseOverrides(raw: unknown): PlanningState['overrides'] {
  const overrides: PlanningState['overrides'] = {}
  for (const [table, layer] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (isPlanningTable(table)) {
      overrides[table] = sanitiseLayer(layer)
    }
  }
  return overrides
}

/**
 * Reads a household's sandbox, returning {@link INACTIVE_STATE} when nothing is
 * stored or the stored blob is unusable. Malformed parts are dropped rather
 * than failing the whole read.
 */
export function readPlanningMode(householdId: string): PlanningState {
  try {
    const stored = localStorage.getItem(planningStorageKey(householdId))
    if (!stored) {
      return INACTIVE_STATE
    }
    const parsed = JSON.parse(stored) as Partial<PlanningState>
    return { active: parsed.active === true, overrides: sanitiseOverrides(parsed.overrides) }
  } catch {
    return INACTIVE_STATE
  }
}

/** Persists a household's sandbox. A storage failure (private mode, quota) is swallowed. */
export function writePlanningMode(householdId: string, state: PlanningState): void {
  try {
    localStorage.setItem(planningStorageKey(householdId), JSON.stringify(state))
  } catch {
    // The sandbox stays in memory for this session; it just will not survive a reload.
  }
}

/** Removes a household's sandbox from storage. A storage failure is swallowed. */
export function clearPlanningMode(householdId: string): void {
  try {
    localStorage.removeItem(planningStorageKey(householdId))
  } catch {
    // Nothing to do — a missing key is already the desired state.
  }
}

/**
 * Applies a layer to a real row list: hidden rows dropped, patched rows merged
 * by id, sandbox-created rows appended (also merged with any later patch, and
 * dropped if later deleted). The input list is not mutated.
 */
export function applyOverrides<T extends PlanningRow>(
  rows: readonly T[],
  layer: PlanningLayer | undefined,
): T[] {
  if (!layer) {
    return [...rows]
  }
  const deletes = new Set(layer.deletes)
  const merged = rows
    .filter((row) => !deletes.has(row.id))
    .map((row) => (layer.updates[row.id] ? { ...row, ...layer.updates[row.id] } : row))
  const created = layer.creates
    .filter((row) => !deletes.has(row.id))
    .map((row) => (layer.updates[row.id] ? { ...row, ...layer.updates[row.id] } : row)) as T[]
  return [...merged, ...created]
}

/** The number of pending edits across every table's layer. */
export function countPending(overrides: PlanningState['overrides']): number {
  return Object.values(overrides).reduce(
    (total, layer) =>
      total + Object.keys(layer.updates).length + layer.creates.length + layer.deletes.length,
    0,
  )
}

/** Returns a new layer with `patch` merged into `id`'s field patches. */
export function layerUpdate(
  layer: PlanningLayer,
  id: string,
  patch: Record<string, unknown>,
): PlanningLayer {
  return { ...layer, updates: { ...layer.updates, [id]: { ...layer.updates[id], ...patch } } }
}

/** Returns a new layer with `row` appended to the sandbox-created rows. */
export function layerCreate(layer: PlanningLayer, row: PlanningRow): PlanningLayer {
  return { ...layer, creates: [...layer.creates, row] }
}

/**
 * Returns a new layer with `id` removed: a sandbox-created row is dropped
 * outright, a real row is added to `deletes`. Any field patch for `id` is
 * discarded either way.
 */
export function layerDelete(layer: PlanningLayer, id: string): PlanningLayer {
  const updates = { ...layer.updates }
  delete updates[id]
  const wasCreated = layer.creates.some((row) => row.id === id)
  return {
    updates,
    creates: layer.creates.filter((row) => row.id !== id),
    deletes: wasCreated || layer.deletes.includes(id) ? layer.deletes : [...layer.deletes, id],
  }
}

/** Returns a new layer with every trace of `id` removed — its patch, its create, its delete. */
export function layerResetRow(layer: PlanningLayer, id: string): PlanningLayer {
  const updates = { ...layer.updates }
  delete updates[id]
  return {
    updates,
    creates: layer.creates.filter((row) => row.id !== id),
    deletes: layer.deletes.filter((deleted) => deleted !== id),
  }
}
