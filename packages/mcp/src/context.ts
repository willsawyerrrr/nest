import type { SupabaseClient } from '@supabase/supabase-js'
import { fixedError, ToolError } from './errors.ts'

/** What every tool runs with: the member's own client and who they are. */
export interface NestContext {
  /** Signed in as a household member; every call runs under row-level security. */
  supabase: SupabaseClient
  householdId: string
  /** The signed-in member's `members.id`. */
  memberId: string
  now: () => Date
  /** Reads a local file; injected so tests need no disk. */
  readFile: (path: string) => Promise<Uint8Array>
  randomUUID: () => string
}

export interface MemberRef {
  id: string
  name: string
}

/** Reads every row of `table` the member can see, optionally narrowed by equality filters. */
export async function selectAll<T>(
  ctx: NestContext,
  table: string,
  filters: Readonly<Record<string, string | number>> = {},
): Promise<T[]> {
  let query = ctx.supabase.from(table).select('*')
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value)
  }
  const { data, error } = await query
  if (error) {
    throw fixedError('query_failed')
  }
  return (data ?? []) as T[]
}

/** The household's members. */
export async function listMembers(ctx: NestContext): Promise<MemberRef[]> {
  const rows = await selectAll<MemberRef>(ctx, 'members')
  return rows.map(({ id, name }) => ({ id, name }))
}

/**
 * Resolves a member given by name (case-insensitive) or id, defaulting to the
 * signed-in member when none is given.
 */
export async function resolveMember(ctx: NestContext, reference?: string): Promise<MemberRef> {
  const members = await listMembers(ctx)
  if (reference === undefined) {
    return members.find((member) => member.id === ctx.memberId) ?? { id: ctx.memberId, name: '' }
  }
  const wanted = reference.trim().toLowerCase()
  const match = members.find(
    (member) => member.id.toLowerCase() === wanted || member.name.trim().toLowerCase() === wanted,
  )
  if (!match) {
    throw new ToolError('not_found', `No household member matches "${reference}".`)
  }
  return match
}
