import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../lib/database.types'

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
): Promise<{ data: unknown; error: unknown }> {
  let query = from(table).select('*')
  for (const [column, value] of Object.entries(match)) {
    query = query.eq(column, value)
  }
  for (const column of order) {
    query = query.order(column)
  }
  return query
}

/**
 * The household-scoped CRUD pattern every collection hook shares: load the
 * household's rows (RLS scopes reads) with an optional order and equality
 * filters, and create, update, and remove rows, reloading after each write so
 * derived state stays in step. `household_id` is injected on every insert.
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
  const [rows, setRows] = useState<Row<T>[] | null>(null)

  // Snapshot the scope so the callbacks re-memoize only when it changes in
  // substance, not when the config object literal is recreated each render.
  const orderKey = orderColumns(config.orderBy).join(',')
  const matchKey = JSON.stringify(config.match ?? {})
  const defaultsKey = JSON.stringify(config.insertDefaults ?? {})
  const order = useMemo(() => orderColumns(config.orderBy), [orderKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const match = useMemo(() => config.match ?? {}, [matchKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const insertDefaults = useMemo(() => config.insertDefaults ?? {}, [defaultsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    const { data, error } = await loadRows(table, match, order)
    if (error) {
      throw error
    }
    setRows(data as Row<T>[])
  }, [table, match, order])

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

  useEffect(() => {
    void reload()
  }, [reload])

  return { rows, loading: rows === null, reload, create, update, remove }
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
  const [rows, setRows] = useState<Row<T>[] | null>(null)

  const matchKey = JSON.stringify(config.match ?? {})
  const defaultsKey = JSON.stringify(config.insertDefaults ?? {})
  const match = useMemo(() => config.match ?? {}, [matchKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const insertDefaults = useMemo(() => config.insertDefaults ?? {}, [defaultsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(async () => {
    const { data, error } = await loadRows(table, match, [])
    if (error) {
      throw error
    }
    setRows(data as Row<T>[])
  }, [table, match])

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

  useEffect(() => {
    void reload()
  }, [reload])

  return { rows, loading: rows === null, reload, upsert }
}
