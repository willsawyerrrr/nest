/**
 * The sync flow, with its I/O injected so the row-building and orchestration
 * logic is unit-tested without a network or database. `index.ts` wires the real
 * member enumeration, Vault token read, Up calls, and writes.
 *
 * Two passes per member, in order: every Up account's balance, then the
 * gift-category transactions over a trailing window. The account pass runs first
 * so a transaction resolves against an account that is certain to be present.
 * The account pass also reconciles: the ids a member's token returned are the
 * authoritative set for that member's individually-owned Up accounts, and one
 * the token no longer reports is deleted when nothing references it or flagged
 * `deleted_from_source_at` when something does.
 */

import type { UpAccount, UpTransaction } from '../_shared/up.ts'
import {
  type AccountUpsert,
  mapAccount,
  mapTransaction,
  type SyncedAccount,
  type TransactionUpsert,
} from './map.ts'

/**
 * The one Up category the poll ingests. Up files gifts and charity donations
 * together, so a candidate may be either; the household tells them apart by
 * linking one to a gift budget or dismissing it.
 */
export const UP_GIFT_CATEGORY = 'gifts-and-charity'

/**
 * How far back each run rescans for gift-category transactions.
 *
 * The window is rescanned in full every run rather than advanced as a
 * high-water mark, because a transaction's category is not part of any cursor Up
 * offers: a transaction carries no `updatedAt`, no webhook event fires when
 * someone recategorises one in the Up app, and `filter[since]` filters on
 * `createdAt`, which never moves. Recategorising is the normal case rather than
 * the exception — Up files a purchase under its merchant's category
 * (`clothing-and-accessories` for a present bought at a clothes shop) until the
 * household moves it to gifts by hand, which can be long after the purchase — so
 * a cursor would step straight past the transactions this poll exists to find.
 *
 * A year keeps a full annual cycle of occasions in scope, and the window is
 * sized for that rather than for volume: `filter[category]` already narrows the
 * poll to gifts and charity, a handful of pages across a whole year.
 *
 * Ageing out of the window is not deletion — the prune reaches only
 * `posted_at >= since` — so an older candidate stops being refreshed and stays
 * in the inbox. The corollary is that a transaction recategorised away from
 * gifts once it has aged out is never pruned automatically; dismissing it as
 * "not a gift" is what clears it.
 */
export const GIFT_WINDOW_DAYS = 365

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/** The start of the trailing gift window ending at `now`. */
export function giftWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - GIFT_WINDOW_DAYS * MILLISECONDS_PER_DAY)
}

/** A connected member and the household its accounts belong to. */
export interface ConnectedMember {
  memberId: string
  householdId: string
  /** The member's display name, used to disambiguate individual account names. */
  name: string
}

/** An account upsert row stamped with its household and owning member. */
export interface AccountRow extends AccountUpsert {
  household_id: string
  owner_member_id: string | null
}

/** One member's gift-category window, as `sync_up_gift_transactions` takes it. */
export interface GiftTransactionWindow {
  householdId: string
  /** The local account ids the window covers, and the prune's exact scope. */
  accountIds: string[]
  /** The window's start, an RFC-3339 instant. */
  since: string
  rows: TransactionUpsert[]
}

/** One member's authoritative Up-account set for the reconcile pass. */
export interface AccountReconcile {
  memberId: string
  householdId: string
  /** Every Up account id this member's token returned this run. */
  presentExternalIds: string[]
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
  /**
   * Reconciles a member's individually-owned Up accounts against the ids their
   * token returned: deletes the unreferenced ones the token dropped and flags
   * the referenced ones `deleted_from_source_at`. Called only for a member whose
   * token read succeeded.
   */
  reconcileAccounts: (reconcile: AccountReconcile) => Promise<void>
  /** Lists the token owner's gift-category transactions created since `since`. */
  listGiftTransactions: (token: string, since: Date) => Promise<UpTransaction[]>
  /** Resolves the local ledger rows for the given Up account ids. */
  listSyncedAccounts: (externalIds: string[]) => Promise<SyncedAccount[]>
  /** Lands one member's gift window and prunes what Up no longer reports in it. */
  syncGiftTransactions: (window: GiftTransactionWindow) => Promise<void>
}

export interface SyncResult {
  members: number
  accounts: number
  transactions: number
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
 * The stored name for an account. An individual spending account is typically
 * just named "Spending", which collides between the household's two members, so
 * it is prefixed with the owner's name in possessive form (e.g. "Alex's
 * Spending"). Joint accounts (shared) and savers (already distinctly named) keep
 * Up's `displayName`. The name is recomputed from `displayName` on every sync,
 * so repeated syncs never double-prefix ("Alex's Alex's Spending").
 */
export function accountName(account: UpAccount, member: ConnectedMember, shared: boolean): string {
  const { displayName, accountType } = account.attributes
  return !shared && accountType === 'TRANSACTIONAL'
    ? `${member.name}'s ${displayName}`
    : displayName
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
  return accounts.map((account) => {
    const shared = account.attributes.ownershipType === 'JOINT'
    return {
      ...mapAccount(account),
      name: accountName(account, member, shared),
      household_id: member.householdId,
      owner_member_id: shared ? null : member.memberId,
    }
  })
}

/**
 * Lands one member's gift-category window and returns how many transactions it
 * carried. The window covers every account that member's token can see, which is
 * also the prune's scope: the accounts named here are the ones a stale candidate
 * may be deleted from, so passing the member's own set is what keeps the prune
 * from reaching a co-member's rows or leaving a stale candidate behind on one of
 * their own. A joint account belongs to both members' windows, and settling it
 * twice is harmless — each pass sees the same Up result set for it.
 *
 * The RPC is called even when Up returns nothing, because an empty result is
 * meaningful: it means the window holds no gift-category transactions at all, so
 * the prune clears whatever the last run left there.
 */
async function syncGiftWindow(
  deps: SyncDeps,
  member: ConnectedMember,
  token: string,
  externalIds: string[],
  since: Date,
): Promise<number> {
  const accounts = await deps.listSyncedAccounts(externalIds)
  const byExternalId = new Map(accounts.map((account) => [account.external_id, account]))
  const transactions = await deps.listGiftTransactions(token, since)
  const rows = transactions
    .map((transaction) => mapTransaction(transaction, byExternalId))
    .filter((row): row is TransactionUpsert => row !== null)

  await deps.syncGiftTransactions({
    householdId: member.householdId,
    accountIds: accounts.map((account) => account.id),
    since: since.toISOString(),
    rows,
  })
  return rows.length
}

/**
 * Polls each connected member's Up accounts, upserts their balances into the
 * ledger, then settles their gift-category transactions over the trailing
 * window. Idempotent: a re-run updates existing rows in place (balance, name,
 * type, currency; a transaction's amount, status, and category) and creates no
 * duplicates. A member without a readable token is skipped rather than failing
 * the whole run.
 *
 * A joint account surfaces through both partners' tokens under the same Up id;
 * it is processed once, on its first sighting, so its shared ownership stays
 * stable rather than being rewritten by whichever member syncs last.
 *
 * Between the two, the account reconcile runs against the ids the member's token
 * just returned: it deletes that member's individually-owned Up accounts the
 * token no longer reports and flags the ones something still references. It is
 * reached only past the token read, so an unreadable token reconciles nothing;
 * joint accounts, owned by neither member, are out of scope. A failure in it
 * costs only that member's reconcile.
 *
 * A member's gift window is settled independently of the balances: it runs after
 * the account upsert, so every account a transaction can name is already in the
 * ledger, and a failure in it costs only that member's candidates rather than
 * the whole run's balances.
 *
 * `householdId` scopes the run to one household's connected members (a caller's
 * manual refresh); null syncs every connected member (the cron path).
 */
export async function runSync(
  deps: SyncDeps,
  householdId: string | null = null,
): Promise<SyncResult> {
  const members = membersToSync(await deps.listConnectedMembers(), householdId)
  const since = giftWindowStart()
  const seen = new Set<string>()
  let accounts = 0
  let transactions = 0

  for (const member of members) {
    const token = await deps.tokenFor(member.memberId)
    if (!token) continue

    const upAccounts = await deps.listAccounts(token)
    const rows = buildAccountRows(upAccounts, member)
      .filter((row) => !seen.has(row.external_id))
    if (rows.length > 0) {
      for (const row of rows) seen.add(row.external_id)
      await deps.upsertAccounts(rows)
      accounts += rows.length
    }

    const externalIds = upAccounts.map((account) => account.id)

    // The token read succeeded, so its ids are authoritative for this member's
    // own Up accounts: drop the ones it no longer reports, flag the referenced
    // ones. A failure here costs only this member's reconcile.
    try {
      await deps.reconcileAccounts({
        memberId: member.memberId,
        householdId: member.householdId,
        presentExternalIds: externalIds,
      })
    } catch (error) {
      console.error(`Account reconcile failed for member ${member.memberId}:`, error)
    }

    try {
      transactions += await syncGiftWindow(deps, member, token, externalIds, since)
    } catch (error) {
      console.error(`Gift transaction sync failed for member ${member.memberId}:`, error)
    }
  }

  return { members: members.length, accounts, transactions }
}
