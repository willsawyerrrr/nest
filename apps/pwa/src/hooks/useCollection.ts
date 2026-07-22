import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

/** A public table whose rows a household owns. */
type HouseholdTable = keyof Database['public']['Tables']
type Row<T extends HouseholdTable> = Database['public']['Tables'][T]['Row']

/** Equality filters and injected insert fields; a foreign key or a financial year. */
type ScopeValue = string | number

/**
 * A table-agnostic view of a PostgREST query builder. A generic table name
 * defeats supabase-js's per-table typing, so the query mechanics run through
 * this loose view; the row and input types stay exact at each hook's boundary.
 */
interface QueryBuilder extends PromiseLike<{ data: unknown; error: unknown }> {
  select(columns: string): QueryBuilder
  insert(values: unknown): QueryBuilder
  upsert(values: unknown, options: { onConflict: string }): QueryBuilder
  update(values: unknown): QueryBuilder
  delete(): QueryBuilder
  eq(column: string, value: ScopeValue): QueryBuilder
  order(column: string): QueryBuilder
}

const from = supabase.from.bind(supabase) as unknown as (table: HouseholdTable) => QueryBuilder

/** Describes how a household collection loads, creates, updates, and removes its rows. */
export interface CollectionConfig<T extends HouseholdTable> {
  /** The table the collection reads and mutates. */
  table: T
  /** Columns to order the load by, ascending, applied in the order given. */
  orderBy?: string | readonly string[]
  /** Equality filters narrowing the load (e.g. a parent id or the financial year). */
  match?: Readonly<Record<string, ScopeValue>>
  /** Fields merged into every insert alongside `household_id` (e.g. a parent id). */
  insertDefaults?: Readonly<Record<string, ScopeValue>>
}

/** The load, create, update, and remove surface of a household collection. */
export interface HouseholdCollection<RowType, CreateInput, UpdateInput> {
  rows: RowType[] | null
  loading: boolean
  reload: () => Promise<void>
  create: (input: CreateInput) => Promise<void>
  update: (id: string, input: UpdateInput) => Promise<void>
  remove: (id: string) => Promise<void>
}

function orderColumns(orderBy: string | readonly string[] | undefined): readonly string[] {
  if (Array.isArray(orderBy)) {
    return orderBy
  }
  return orderBy ? [orderBy as string] : []
}

async function loadRows(
  table: HouseholdTable,
  match: Readonly<Record<string, ScopeValue>>,
  order: readonly string[],
): Promise<unknown> {
  let query = from(table).select('*')
  for (const [column, value] of Object.entries(match)) {
    query = query.eq(column, value)
  }
  for (const column of order) {
    query = query.order(column)
  }
  const { data, error } = await query
  if (error) {
    throw error
  }
  return data
}

/**
 * A collection's cache key: its table, the household, and the stable scope
 * (order columns and equality filters). Two hooks reading the same table with
 * the same scope share one cache entry and one in-flight request.
 */
function collectionKey(
  table: HouseholdTable,
  householdId: string,
  matchKey: string,
  orderKey: string,
): QueryKey {
  return [table, householdId, matchKey, orderKey]
}

/**
 * The household-scoped CRUD pattern every collection hook shares: load the
 * household's rows (RLS scopes reads) with an optional order and equality
 * filters, and create, update, and remove rows. Reads are cached household-
 * scoped and revalidated in the background, so a revisit renders the cached
 * rows immediately while `loading` reports only the first, uncached load. Each
 * write invalidates every cache entry under the `[table, householdId]` prefix, so
 * both this scope and any other scope reading the same table refresh — a match-
 * scoped detail query and the unscoped roll-up of the same table stay in step.
 * `household_id` is injected on every insert.
 */
export function useHouseholdCollection<
  T extends HouseholdTable,
  CreateInput,
  UpdateInput = CreateInput,
>(
  householdId: string,
  config: CollectionConfig<T>,
): HouseholdCollection<Row<T>, CreateInput, UpdateInput> {
  const { table } = config
  const queryClient = useQueryClient()

  // Snapshot the scope so the callbacks and query key re-derive only when it
  // changes in substance, not when the config object literal is recreated each
  // render.
  const orderKey = orderColumns(config.orderBy).join(',')
  const matchKey = JSON.stringify(config.match ?? {})
  const defaultsKey = JSON.stringify(config.insertDefaults ?? {})
  const order = useMemo(() => orderColumns(config.orderBy), [orderKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const match = useMemo(() => config.match ?? {}, [matchKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const insertDefaults = useMemo(() => config.insertDefaults ?? {}, [defaultsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const queryKey = useMemo(
    () => collectionKey(table, householdId, matchKey, orderKey),
    [table, householdId, matchKey, orderKey],
  )

  const query = useQuery({
    queryKey,
    queryFn: async () => (await loadRows(table, match, order)) as Row<T>[],
  })

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [table, householdId] })
  }, [queryClient, table, householdId])

  const create = useCallback(
    async (input: CreateInput) => {
      const { error } = await from(table).insert({
        ...input,
        ...insertDefaults,
        household_id: householdId,
      })
      if (error) {
        throw error
      }
      await reload()
    },
    [table, insertDefaults, householdId, reload],
  )

  const update = useCallback(
    async (id: string, input: UpdateInput) => {
      const { error } = await from(table).update(input).eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [table, reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await from(table).delete().eq('id', id)
      if (error) {
        throw error
      }
      await reload()
    },
    [table, reload],
  )

  return { rows: query.data ?? null, loading: query.isPending, reload, create, update, remove }
}

/** The load and upsert surface of a financial-year-keyed household collection. */
export interface HouseholdUpsertCollection<RowType, UpsertInput> {
  rows: RowType[] | null
  loading: boolean
  reload: () => Promise<void>
  upsert: (input: UpsertInput) => Promise<void>
}

/** Describes an upsert-only collection keyed by member and financial year. */
export interface UpsertCollectionConfig<T extends HouseholdTable> {
  /** The table the collection reads and upserts. */
  table: T
  /** Equality filters narrowing the load (the financial year). */
  match?: Readonly<Record<string, ScopeValue>>
  /** Fields merged into every upsert alongside `household_id` (the financial year). */
  insertDefaults?: Readonly<Record<string, ScopeValue>>
  /** The unique columns an upsert conflicts on. */
  onConflict: string
}

/**
 * The upsert variant of {@link useHouseholdCollection} for the per-member,
 * per-financial-year profile tables, whose rows are created or replaced in one
 * step rather than through separate create, update, and remove writes.
 */
export function useHouseholdUpsertCollection<T extends HouseholdTable, UpsertInput>(
  householdId: string,
  config: UpsertCollectionConfig<T>,
): HouseholdUpsertCollection<Row<T>, UpsertInput> {
  const { table, onConflict } = config
  const queryClient = useQueryClient()

  const matchKey = JSON.stringify(config.match ?? {})
  const defaultsKey = JSON.stringify(config.insertDefaults ?? {})
  const match = useMemo(() => config.match ?? {}, [matchKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const insertDefaults = useMemo(() => config.insertDefaults ?? {}, [defaultsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const queryKey = useMemo(
    () => collectionKey(table, householdId, matchKey, ''),
    [table, householdId, matchKey],
  )

  const query = useQuery({
    queryKey,
    queryFn: async () => (await loadRows(table, match, [])) as Row<T>[],
  })

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [table, householdId] })
  }, [queryClient, table, householdId])

  const upsert = useCallback(
    async (input: UpsertInput) => {
      const { error } = await from(table).upsert(
        { ...input, ...insertDefaults, household_id: householdId },
        { onConflict },
      )
      if (error) {
        throw error
      }
      await reload()
    },
    [table, insertDefaults, householdId, onConflict, reload],
  )

  return { rows: query.data ?? null, loading: query.isPending, reload, upsert }
}
