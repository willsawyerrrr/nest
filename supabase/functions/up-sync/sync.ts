/**
 * The accounts-only sync flow, with its I/O injected so the row-building and
 * orchestration logic is unit-tested without a network or database. `index.ts`
 * wires the real member enumeration, Vault token read, Up call, and upsert.
 *
 * Transactions are deferred to a later ledger phase; this poll reconciles only
 * account balances.
 */

import type { UpAccount } from '../_shared/up.ts'
import { type AccountUpsert, mapAccount } from './map.ts'

/** A connected member and the household its accounts belong to. */
export interface ConnectedMember {
  memberId: string
  householdId: string
}

/** An account upsert row stamped with its household and owning member. */
export interface AccountRow extends AccountUpsert {
  household_id: string
  owner_member_id: string | null
}

export interface SyncDeps {
  /** Members whose Up token is stored (up_connected_at is not null). */
  listConnectedMembers: () => Promise<ConnectedMember[]>
  /** Reads a member's decrypted Up token, or null when unavailable. */
  tokenFor: (memberId: string) => Promise<string | null>
  /** Lists the token owner's Up accounts. */
  listAccounts: (token: string) => Promise<UpAccount[]>
  /** Upserts account rows on conflict (source, external_id). */
  upsertAccounts: (rows: AccountRow[]) => Promise<void>
}

export interface SyncResult {
  members: number
  accounts: number
}

/**
 * Narrows the connected members a run should touch to the caller's context. A
 * JWT-invoked call passes its resolved `householdId` and syncs only that
 * household's connected members; the cron path passes null and syncs all. The
 * household filter is defence in depth on top of RLS: the service-role sync
 * bypasses RLS, so scoping the row set is what keeps a member's manual refresh
 * from touching another household's balances.
 */
export function membersToSync(
  members: ConnectedMember[],
  householdId: string | null,
): ConnectedMember[] {
  return householdId === null
    ? members
    : members.filter((member) => member.householdId === householdId)
}

/**
 * Builds the account upsert rows for one member. An Up account owned jointly is
 * shared across the household (`owner_member_id` null); an individual account is
 * attributed to the member. A joint account seen through both partners' tokens
 * carries the same Up id, so the (source, external_id) upsert collapses it to a
 * single row rather than duplicating it.
 */
export function buildAccountRows(
  accounts: UpAccount[],
  member: ConnectedMember,
): AccountRow[] {
  return accounts.map((account) => ({
    ...mapAccount(account),
    household_id: member.householdId,
    owner_member_id: account.attributes.ownershipType === 'JOINT' ? null : member.memberId,
  }))
}

/**
 * Polls each connected member's Up accounts and upserts their balances into the
 * ledger. Idempotent: a re-run updates existing rows in place (balance, name,
 * type, currency) and creates no duplicates. A member without a readable token
 * is skipped rather than failing the whole run.
 *
 * `householdId` scopes the run to one household's connected members (a caller's
 * manual refresh); null syncs every connected member (the cron path).
 */
export async function runSync(
  deps: SyncDeps,
  householdId: string | null = null,
): Promise<SyncResult> {
  const members = membersToSync(await deps.listConnectedMembers(), householdId)
  let accounts = 0

  for (const member of members) {
    const token = await deps.tokenFor(member.memberId)
    if (!token) continue

    const rows = buildAccountRows(await deps.listAccounts(token), member)
    if (rows.length === 0) continue

    await deps.upsertAccounts(rows)
    accounts += rows.length
  }

  return { members: members.length, accounts }
}
