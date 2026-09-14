/**
 * The Redbark sync flow, with its I/O injected so the row-building and
 * orchestration logic is unit-tested without a network or database.
 * `index.ts` wires the real connection enumeration, Redbark calls, and writes.
 *
 * Per connection: list its accounts, filter to `category === 'banking'`
 * (brokerage accounts have no home in the schema and are out of scope), read
 * each surviving account's balance, and upsert the resulting rows via the
 * shared `upsert_accounts` RPC. Then, per member, reconcile that member's
 * Redbark-sourced accounts against the union of external ids present across
 * every one of their connections — a member can have more than one bank
 * connected — via `reconcile_source_accounts`.
 *
 * Every Redbark connection belongs to exactly one member (Redbark exposes no
 * ownership field, so there is no joint-Redbark concept — see
 * redbark_connection's comment), so there is no joint reconcile pass the way
 * Up has one, and no per-connection credential check to skip on failure: the
 * platform-wide API key is either configured or the function never starts
 * (see index.ts). A failure reading a connection's accounts or a balance
 * (including a 429) is not swallowed here — it propagates, matching up-sync's
 * account pass, which is likewise unguarded; only the reconcile call below is
 * wrapped so one member's reconcile failure costs only that member.
 */

import type { RedbarkAccount, RedbarkBalance } from '../_shared/redbark.ts'
import { type AccountUpsert, mapAccount } from './map.ts'

/** One household's Redbark connection, joined to its owning member's name. */
export interface Connection {
  id: string
  householdId: string
  memberId: string
  memberName: string
}

/** An account upsert row stamped with its household and owning member. */
export interface AccountRow extends AccountUpsert {
  household_id: string
  owner_member_id: string
}

/** One member's authoritative Redbark-account set for the reconcile pass. */
export interface AccountReconcile {
  memberId: string
  householdId: string
  /** Every Redbark account id present across all of this member's connections this run. */
  presentExternalIds: string[]
}

export interface SyncDeps {
  /** Every redbark_connection row in scope, joined to its owning member's name. */
  listConnections: () => Promise<Connection[]>
  /** Lists a connection's accounts (both banking and brokerage). */
  listAccounts: (connectionId: string) => Promise<RedbarkAccount[]>
  /** Reads one account's balance. */
  getBalance: (accountId: string) => Promise<RedbarkBalance>
  /** Upserts account rows via the shared upsert_accounts RPC. */
  upsertAccounts: (rows: AccountRow[]) => Promise<void>
  /**
   * Reconciles a member's Redbark-sourced accounts against the ids present
   * across every one of their connections this run: deletes the unreferenced
   * ones no connection reports any more and flags the referenced ones
   * `deleted_from_source_at`.
   */
  reconcileAccounts: (reconcile: AccountReconcile) => Promise<void>
}

export interface SyncResult {
  connections: number
  accounts: number
}

/**
 * Narrows the connections a run should touch to the caller's context. A
 * JWT-invoked call passes its resolved `householdId` and syncs only that
 * household's connections; the cron path passes null and syncs all.
 */
export function connectionsToSync(
  connections: Connection[],
  householdId: string | null,
): Connection[] {
  return householdId === null
    ? connections
    : connections.filter((connection) => connection.householdId === householdId)
}

/**
 * Polls every connection in scope, upserts its banking accounts' balances into
 * the ledger, then — per member, once every one of their connections has been
 * read this run — reconciles that member's Redbark accounts against the union
 * of the ids their connections returned.
 */
export async function runSync(
  deps: SyncDeps,
  householdId: string | null = null,
): Promise<SyncResult> {
  const connections = connectionsToSync(await deps.listConnections(), householdId)
  let accounts = 0

  // Per member: the household they belong to, and the union of external ids
  // present across every one of their connections — the reconcile's input.
  const members = new Map<string, { householdId: string; presentExternalIds: string[] }>()

  for (const connection of connections) {
    const bankingAccounts = (await deps.listAccounts(connection.id))
      .filter((account) => account.category === 'banking')

    const rows: AccountRow[] = []
    for (const account of bankingAccounts) {
      const balance = await deps.getBalance(account.id)
      rows.push({
        ...mapAccount(account, balance, connection.memberName),
        household_id: connection.householdId,
        owner_member_id: connection.memberId,
      })
    }

    if (rows.length > 0) {
      await deps.upsertAccounts(rows)
      accounts += rows.length
    }

    const member = members.get(connection.memberId) ??
      { householdId: connection.householdId, presentExternalIds: [] }
    member.presentExternalIds.push(...bankingAccounts.map((account) => account.id))
    members.set(connection.memberId, member)
  }

  // Every connection this run touched has landed its accounts, so the union of
  // ids gathered per member is authoritative for that member's Redbark
  // accounts. A failure here costs only that member's reconcile.
  for (const [memberId, member] of members) {
    try {
      await deps.reconcileAccounts({
        memberId,
        householdId: member.householdId,
        presentExternalIds: member.presentExternalIds,
      })
    } catch (error) {
      console.error(`Redbark account reconcile failed for member ${memberId}:`, error)
    }
  }

  return { connections: connections.length, accounts }
}
