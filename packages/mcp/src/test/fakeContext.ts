import type { SupabaseClient } from '@supabase/supabase-js'
import type { NestContext } from '../context.ts'

type Row = Record<string, unknown>

export interface FakeState {
  tables: Record<string, Row[]>
  inserts: { table: string; row: Row }[]
  rpcCalls: { fn: string; args: Row }[]
  uploads: { path: string; contentType: string | undefined; bytes: number }[]
  removed: string[]
  invocations: { fn: string; body: unknown }[]
}

export interface FakeOptions {
  tables?: Record<string, Row[]>
  insertError?: boolean
  rpcError?: boolean
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
    rpcCalls: [],
    uploads: [],
    removed: [],
    invocations: [],
  }

  const from = (table: string) => {
    const filters: [string, unknown][] = []
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value])
        return builder
      },
      insert: (row: Row) => {
        state.inserts.push({ table, row })
        return {
          select: () => ({
            single: async () =>
              options.insertError
                ? { data: null, error: { message: 'upstream detail' } }
                : { data: { id: 'new-id' }, error: null },
          }),
        }
      },
      then: (resolve: (value: unknown) => unknown) =>
        resolve({
          data: (state.tables[table] ?? []).filter((row) =>
            filters.every(([column, value]) => row[column] === value),
          ),
          error: null,
        }),
    }
    return builder
  }

  const supabase = {
    from,
    rpc: async (fn: string, args: Row) => {
      state.rpcCalls.push({ fn, args })
      return options.rpcError
        ? { data: null, error: { message: 'upstream detail' } }
        : { data: 'ok', error: null }
    },
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array, opts: { contentType?: string }) => {
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
