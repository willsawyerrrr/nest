import type { SupabaseClient } from '@supabase/supabase-js'
import type { NestContext } from '../context.ts'

type Row = Record<string, unknown>

export interface GiftFakeState {
  tables: Record<string, Row[]>
  inserts: { table: string; row: Row }[]
  updates: { table: string; row: Row }[]
  deletes: { table: string; id: unknown }[]
  upserts: { table: string; row: Row; onConflict: string | undefined }[]
}

export interface GiftFakeOptions {
  tables?: Record<string, Row[]>
  /** Every write fails with an upstream error. */
  writeError?: boolean
}

export const SELF = 'm-self'

/**
 * An in-memory stand-in for the Supabase calls the gift tools make. Tables hold
 * only the rows the member's row-level security would let them read.
 */
export function giftContext(options: GiftFakeOptions = {}): {
  ctx: NestContext
  state: GiftFakeState
} {
  const state: GiftFakeState = {
    tables: options.tables ?? {},
    inserts: [],
    updates: [],
    deletes: [],
    upserts: [],
  }
  let counter = 0
  const upstream = { message: 'upstream detail' }

  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let mode: 'select' | 'update' | 'delete' = 'select'
    let patch: Row = {}
    const matching = () =>
      (state.tables[table] ?? []).filter((row) =>
        // The fixtures are one household's rows already, as row-level security leaves them.
        filters.every(([c, v]) => c === 'household_id' || row[c] === v),
      )
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return builder
      },
      update: (row: Row) => {
        mode = 'update'
        patch = row
        return builder
      },
      delete: () => {
        mode = 'delete'
        return builder
      },
      insert: (row: Row) => {
        state.inserts.push({ table, row })
        return {
          select: () => ({
            single: async () =>
              options.writeError
                ? { data: null, error: upstream }
                : { data: { id: `new-${++counter}` }, error: null },
          }),
        }
      },
      upsert: (row: Row, opts?: { onConflict?: string }) => {
        state.upserts.push({ table, row, onConflict: opts?.onConflict })
        return {
          select: () => ({
            single: async () =>
              options.writeError
                ? { data: null, error: upstream }
                : { data: { id: 'buffer-1' }, error: null },
          }),
        }
      },
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (mode === 'update') state.updates.push({ table, row: patch })
        if (mode === 'delete') {
          for (const row of matching()) state.deletes.push({ table, id: row.id })
        }
        if (mode !== 'select' && options.writeError) return resolve({ data: null, error: upstream })
        return resolve({ data: matching(), error: null })
      },
    }
    return builder
  }

  const ctx: NestContext = {
    supabase: { from } as unknown as SupabaseClient,
    householdId: 'h-1',
    memberId: SELF,
    now: () => new Date('2026-10-02T00:00:00Z'),
    readFile: async () => new Uint8Array(),
    randomUUID: () => `uuid-${++counter}`,
  }
  return { ctx, state }
}
