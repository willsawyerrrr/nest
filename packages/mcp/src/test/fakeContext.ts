import type { SupabaseClient } from '@supabase/supabase-js'
import type { NestContext } from '../context.ts'

type Row = Record<string, unknown>

export interface FakeState {
  tables: Record<string, Row[]>
  inserts: { table: string; row: Row }[]
  updates: { table: string; row: Row; filters: [string, unknown][] }[]
  rpcCalls: { fn: string; args: Row }[]
  deletes: { table: string; filters: [string, unknown][] }[]
  upserts: { table: string; row: Row; onConflict: string | undefined }[]
  uploads: { path: string; contentType: string | undefined; bytes: number }[]
  /** The bucket of each upload, in order. */
  uploadBuckets: string[]
  removed: string[]
  invocations: { fn: string; body: unknown }[]
}

export interface FakeOptions {
  tables?: Record<string, Row[]>
  insertError?: boolean
  updateError?: boolean
  rpcError?: boolean
  deleteError?: boolean
  upsertError?: boolean
  /** The message an insert, update, or RPC failure carries; defaults to an upstream detail. */
  failureMessage?: string
  /** What a named RPC answers; any other answers `'ok'`. */
  rpcResults?: Record<string, unknown>
  uploadError?: boolean
  /** What `functions.invoke` answers: a body, or an `error` carrying a Response. */
  invoke?: { data?: unknown; failure?: { status: number; body: unknown } | 'transport' }
  files?: Record<string, Uint8Array>
}

const HOUSEHOLD = 'h-1'
const SELF = 'm-self'

/** An in-memory stand-in for the slice of the Supabase client the tools use. */
export function fakeContext(options: FakeOptions = {}): { ctx: NestContext; state: FakeState } {
  const state: FakeState = {
    tables: options.tables ?? {},
    inserts: [],
    updates: [],
    rpcCalls: [],
    deletes: [],
    upserts: [],
    uploads: [],
    uploadBuckets: [],
    removed: [],
    invocations: [],
  }

  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let pendingUpdate: Row | null = null
    let pendingDelete = false
    const matches = (row: Row) =>
      filters.every(([column, value]) =>
        Array.isArray(value) ? value.includes(row[column]) : row[column] === value,
      )
    const failure = { message: options.failureMessage ?? 'upstream detail' }
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return builder
      },
      in: (column: string, values: unknown[]) => {
        filters.push([column, values])
        return builder
      },
      order: () => builder,
      update: (row: Row) => {
        pendingUpdate = row
        return builder
      },
      delete: () => {
        pendingDelete = true
        return builder
      },
      upsert: async (row: Row, opts?: { onConflict?: string }) => {
        state.upserts.push({ table, row, onConflict: opts?.onConflict })
        return options.upsertError ? { error: failure } : { error: null }
      },
      insert: (row: Row) => {
        state.inserts.push({ table, row })
        const result = options.insertError
          ? { data: null, error: failure }
          : { data: { id: 'new-id' }, error: null }
        return {
          select: () => ({ single: async () => result }),
          then: (resolve: (value: unknown) => unknown) => resolve(result),
        }
      },
      maybeSingle: async () => ({
        data: (state.tables[table] ?? []).find(matches) ?? null,
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) => {
        if (pendingDelete) {
          state.deletes.push({ table, filters })
          if (options.deleteError) return resolve({ data: null, error: failure })
        }
        if (pendingUpdate) {
          state.updates.push({ table, row: pendingUpdate, filters })
          if (options.updateError) return resolve({ data: null, error: failure })
        }
        return resolve({
          data: (state.tables[table] ?? []).filter(matches),
          error: null,
        })
      },
    }
    return builder
  }

  const supabase = {
    from,
    rpc: async (fn: string, args: Row) => {
      state.rpcCalls.push({ fn, args })
      return options.rpcError
        ? { data: null, error: { message: options.failureMessage ?? 'upstream detail' } }
        : {
            data: options.rpcResults?.[fn] ?? 'ok',
            error: null,
          }
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array, opts: { contentType?: string }) => {
          state.uploadBuckets.push(bucket)
          state.uploads.push({ path, contentType: opts.contentType, bytes: bytes.byteLength })
          return options.uploadError ? { error: { message: 'upstream detail' } } : { error: null }
        },
        remove: async (paths: string[]) => {
          state.removed.push(...paths)
          return { error: null }
        },
      }),
    },
    functions: {
      invoke: async (fn: string, init: { body: unknown }) => {
        state.invocations.push({ fn, body: init.body })
        const failure = options.invoke?.failure
        if (failure === 'transport') return { data: null, error: new Error('network') }
        if (failure) {
          return {
            data: null,
            error: {
              context: new Response(JSON.stringify(failure.body), { status: failure.status }),
            },
          }
        }
        return { data: options.invoke?.data ?? null, error: null }
      },
    },
  } as unknown as SupabaseClient

  let counter = 0
  const ctx: NestContext = {
    supabase,
    householdId: HOUSEHOLD,
    memberId: SELF,
    now: () => new Date('2026-10-02T00:00:00Z'),
    readFile: async (path) => {
      const bytes = options.files?.[path]
      if (!bytes) throw new Error('ENOENT')
      return bytes
    },
    randomUUID: () => `uuid-${++counter}`,
  }
  return { ctx, state }
}

export const members = [
  { id: SELF, name: 'Alex' },
  { id: 'm-other', name: 'Sam' },
]
