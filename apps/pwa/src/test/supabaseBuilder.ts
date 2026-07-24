import { vi } from 'vitest'

/**
 * The PostREST query-builder methods a hook exercises. Each is stubbed to
 * return the builder itself so calls chain, matching `@supabase/supabase-js`.
 */
export type BuilderMethod =
  'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'eq' | 'order' | 'single'

/**
 * A chainable, thenable stand-in for a Supabase PostgREST query builder. Every
 * requested method is a `vi.fn` returning the same object, so a hook's chained
 * calls resolve against the single `result` the test sets.
 */
export type SupabaseBuilder = {
  result: { data: unknown; error: unknown }
  then: (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>
} & Record<BuilderMethod, ReturnType<typeof vi.fn>>

/**
 * Build a chainable PostgREST builder mock exposing the given methods. Awaiting
 * the builder (it is thenable) resolves to its current `result`, which a test
 * reassigns to drive success and error paths.
 */
export function makeSupabaseBuilder(methods: readonly BuilderMethod[]): SupabaseBuilder {
  const builder: SupabaseBuilder = {
    result: { data: [], error: null },
  } as SupabaseBuilder
  for (const method of methods) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve(builder.result).then(onFulfilled, onRejected)
  return builder
}
