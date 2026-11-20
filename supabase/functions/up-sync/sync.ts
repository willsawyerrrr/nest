/**
 * The sync flow, with its I/O injected so the row-building and orchestration
 * logic is unit-tested without a network or database. `index.ts` wires the real
 * member enumeration, Vault token read, Up calls, and writes.
 *
 * Three passes per member, in order: every Up account's balance, every account's
 * transactions since its own high-water mark, then a rescan of the gift category
 * over a trailing window. The account pass runs first so a transaction resolves
 * against an account that is certain to be present.
 * The account pass also reconciles: the ids a member's token returned are the
 * authoritative set for that member's individually-owned Up accounts, and one
 * the token no longer reports is deleted when nothing references it or flagged
 * `deleted_from_source_at` when something does. Joint accounts need every
 * connected member of the household to have synced with a readable token in the
 * same run, so they are reconciled once per household after the member loop,
 * against the union of the ids those members' tokens returned.
 *
 * Once per run, the first member whose token lists their accounts also
 * refreshes `up_category` from Up's category taxonomy, which is the same for
 * every token.
 */

import { financialYearBounds, financialYearForDate } from '@nest/tax'
import {
  isUpAuthError,
  type UpAccount,
  type UpCategory,
  type UpTransaction,
} from '../_shared/up.ts'
import {
  type AccountUpsert,
  type CategoryUpsert,
  mapAccount,
  mapCategory,
  mapTransaction,
  type SyncedAccount,
  type TransactionUpsert,
} from './map.ts'

/**
 * The Up category the gift rescan polls. Up files gifts and charity donations
 * together, so a candidate may be either; the household tells them apart by
 * linking one to a gift budget or dismissing it.
 */
export const UP_GIFT_CATEGORY = 'gifts-and-charity'

/**
 * How far back each run rescans for gift-category transactions.
 *
 * The ledger pass follows a per-account high-water mark, which never revisits a
 * transaction once it is behind the mark. A transaction's category is not part
 * of any cursor Up offers: a transaction carries no `updatedAt`, no webhook
 * event fires when someone recategorises one in the Up app, and `filter[since]`
 * filters on `createdAt`, which never moves. Recategorising into gifts is the
 * normal case rather than the exception — Up files a purchase under its
 * merchant's category (`clothing-and-accessories` for a present bought at a
 * clothes shop) until the household moves it to gifts by hand, which can be long
 * after the purchase — so the gift category is rescanned in full every run over
 * this window, catching what the mark has stepped past.
 *
 * A year keeps a full annual cycle of occasions in scope, and the window is
 * sized for that rather than for volume: `filter[category]` narrows the rescan
 * to gifts and charity, a handful of pages across a whole year.
 *
 * A row recategorised away from gifts once it is older than the window is not
 * refreshed and keeps its gift category; dismissing it as "not a gift" is what
 * clears it from the inbox.
 */
export const GIFT_WINDOW_DAYS = 365

/**
 * The overlap the ledger pass re-reads behind an account's latest synced
 * transaction, so a hold that settles after a later transaction was synced, and
 * clock skew between Up and the ledger, are not stepped past. The upsert makes
 * re-reading harmless.
 */
export const LEDGER_OVERLAP_HOURS = 24

/**
 * Australian Eastern Standard Time's offset from UTC. Australia observes no
 * daylight saving on 1 July, so a financial year starts at this offset in every
 * eastern state.
 */
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR

/** Rows per `sync_up_transactions` call, keeping a backfill's payloads modest. */
export const SYNC_BATCH_SIZE = 500

/** The start of the trailing gift window ending at `now`. */
export function giftWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - GIFT_WINDOW_DAYS * MILLISECONDS_PER_DAY)
}

/**
 * Where an account with no synced transactions starts: midnight AEST on 1 July
 * of the financial year before the one `now` falls in. Two financial years of
 * history is all tax and budget reconciliation reads, and it bounds the first
 * run's volume.
 */
export function backfillStart(now: Date = new Date()): Date {
  const { start } = financialYearBounds(financialYearForDate(now) - 1)
  return new Date(start.getTime() - AEST_OFFSET_MS)
}

/**
 * Where the ledger pass resumes one account: {@link LEDGER_OVERLAP_HOURS} behind
 * its latest synced transaction's `posted_at`, or {@link backfillStart} when it
 * has none.
 */
export function ledgerSince(latestPostedAt: string | null, now: Date = new Date()): Date {
  return latestPostedAt === null
    ? backfillStart(now)
    : new Date(Date.parse(latestPostedAt) - LEDGER_OVERLAP_HOURS * MILLISECONDS_PER_HOUR)
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

/** One row `sync_up_transactions` landed, and whether it was new to the ledger. */
export interface SyncedTransaction {
  id: string
  inserted: boolean
}

/** The local gift-category Up rows a member's gift rescan covers. */
export interface StoredGiftQuery {
  /** The local account ids the member's token can see. */
  accountIds: string[]
  /** The window's start, an RFC-3339 instant, bounding `posted_at`. */
  since: string
}

/** One member's authoritative Up-account set for the reconcile pass. */
export interface AccountReconcile {
  memberId: string
  householdId: string
  /** Every Up account id this member's token returned this run. */
  presentExternalIds: string[]
}

/**
 * One household's authoritative joint-Up-account set for the joint reconcile
 * pass. Only built for a household where every connected member in scope synced
 * with a readable token this run.
 */
export interface JointAccountReconcile {
  householdId: string
  /**
   * The union of every Up account id the household's members' tokens returned
   * this run — the set a joint account must be absent from to count as deleted
   * in Up.
   */
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
  /**
   * Reconciles one household's joint (`owner_member_id IS NULL`) Up accounts
   * against the union of the ids its members' tokens returned: deletes the
   * unreferenced ones no member reports any more and flags the referenced ones
   * `deleted_from_source_at`. Called once per household, and only when every
   * connected member of that household synced with a readable token this run.
   */
  reconcileJointAccounts: (reconcile: JointAccountReconcile) => Promise<void>
  /** Resolves the local ledger rows for the given Up account ids. */
  listSyncedAccounts: (externalIds: string[]) => Promise<SyncedAccount[]>
  /**
   * The latest `posted_at` of a local account's synced Up transactions outside
   * the gift category, or null when it has none. Gift-category rows are left
   * out: the gift rescan lands them over its own year-long window, so they say
   * nothing about how far the ledger pass has read. An account whose only
   * transactions are gifts therefore re-reads from {@link backfillStart} each
   * run, which costs a few pages.
   */
  latestPostedAt: (accountId: string) => Promise<string | null>
  /** Lists one Up account's transactions created since `since`. */
  listAccountTransactions: (
    token: string,
    accountId: string,
    since: Date,
  ) => Promise<UpTransaction[]>
  /** Lists the token owner's gift-category transactions created since `since`. */
  listGiftTransactions: (token: string, since: Date) => Promise<UpTransaction[]>
  /** The Up ids of the stored gift-category rows the query covers. */
  listStoredGiftTransactionIds: (query: StoredGiftQuery) => Promise<string[]>
  /** Reads one Up transaction, or null when Up no longer has it. */
  getTransaction: (token: string, id: string) => Promise<UpTransaction | null>
  /** Upserts one household's rows on (source, external_id), never touching `notes`. */
  syncTransactions: (householdId: string, rows: TransactionUpsert[]) => Promise<SyncedTransaction[]>
  /** Deletes a household's Up rows Up no longer has, keeping any a gift purchase links. */
  deleteTransactions: (householdId: string, externalIds: string[]) => Promise<void>
  /** Lists Up's category taxonomy with the token. */
  listCategories: (token: string) => Promise<UpCategory[]>
  /** Upserts the taxonomy into `up_category`. */
  syncCategories: (rows: CategoryUpsert[]) => Promise<void>
  /**
   * Clears a member's Up connection and stamps the failure, so they are
   * prompted to reconnect rather than retried forever. Called only when the
   * token read is rejected with 401/403 — never on a transient failure, so a
   * network blip or an Up outage never costs the member their connection.
   */
  disconnectMember: (memberId: string) => Promise<void>
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
 * Lands `rows` for one household in {@link SYNC_BATCH_SIZE} batches, one row per
 * Up id (the last wins), since a single upsert cannot touch one row twice.
 * Returns how many rows it landed.
 */
async function landTransactions(
  deps: SyncDeps,
  householdId: string,
  rows: TransactionUpsert[],
): Promise<number> {
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()]
  for (let i = 0; i < unique.length; i += SYNC_BATCH_SIZE) {
    await deps.syncTransactions(householdId, unique.slice(i, i + SYNC_BATCH_SIZE))
  }
  return unique.length
}

/** Maps Up transactions to ledger rows, skipping those on an unsynced account. */
function mapTransactions(
  transactions: UpTransaction[],
  accounts: ReadonlyMap<string, SyncedAccount>,
): TransactionUpsert[] {
  return transactions
    .map((transaction) => mapTransaction(transaction, accounts))
    .filter((row): row is TransactionUpsert => row !== null)
}

/**
 * Lands every transaction on one member's accounts since each account's own
 * high-water mark ({@link ledgerSince}), returning how many it carried. Each
 * account resumes from its own mark, so an account newly visible to the member
 * is backfilled even when their others are current, and an account with no
 * transactions costs one empty page. An account already settled this run
 * (`settled`, a joint account seen through a partner's token) is skipped, and
 * one joins `settled` only once its rows have landed.
 */
async function syncLedger(
  deps: SyncDeps,
  member: ConnectedMember,
  token: string,
  accounts: ReadonlyMap<string, SyncedAccount>,
  settled: Set<string>,
  now: Date,
): Promise<number> {
  let landed = 0
  for (const account of accounts.values()) {
    if (settled.has(account.id)) continue
    const since = ledgerSince(await deps.latestPostedAt(account.id), now)
    const transactions = await deps.listAccountTransactions(token, account.external_id, since)
    // Oldest first, so a run that fails between batches leaves the mark at the
    // newest row it landed and the next run re-reads everything after it.
    const rows = mapTransactions(transactions, accounts)
      .sort((a, b) => Date.parse(a.posted_at) - Date.parse(b.posted_at))
    landed += await landTransactions(deps, member.householdId, rows)
    settled.add(account.id)
  }
  return landed
}

/**
 * Rescans one member's gift category over the trailing window and returns how
 * many rows it landed. The window's rows are upserted, which lands a
 * transaction recategorised into gifts after the ledger pass's mark passed it.
 *
 * A stored gift-category row in the window that Up no longer lists in the
 * category was recategorised away, or deleted. Each is re-read from Up: one
 * that still exists is refreshed in place with its new category, so the row and
 * whatever the household attached to it stay; one Up no longer has is deleted,
 * unless a gift purchase links it. The stored rows are confined to the member's
 * own accounts, so the rescan never reaches a co-member's rows.
 */
async function syncGiftWindow(
  deps: SyncDeps,
  member: ConnectedMember,
  token: string,
  accounts: ReadonlyMap<string, SyncedAccount>,
  since: Date,
): Promise<number> {
  const listed = await deps.listGiftTransactions(token, since)
  const listedIds = new Set(listed.map((transaction) => transaction.id))
  const stored = await deps.listStoredGiftTransactionIds({
    accountIds: [...accounts.values()].map((account) => account.id),
    since: since.toISOString(),
  })

  const refreshed: UpTransaction[] = []
  const gone: string[] = []
  for (const id of stored) {
    if (listedIds.has(id)) continue
    const transaction = await deps.getTransaction(token, id)
    if (transaction) refreshed.push(transaction)
    else gone.push(id)
  }

  const landed = await landTransactions(
    deps,
    member.householdId,
    mapTransactions([...listed, ...refreshed], accounts),
  )
  if (gone.length > 0) await deps.deleteTransactions(member.householdId, gone)
  return landed
}

/**
 * Polls each connected member's Up accounts, upserts their balances into the
 * ledger, lands every transaction since each account's high-water mark, then
 * rescans their gift category over the trailing window. Idempotent: a re-run
 * updates existing rows in place (balance, name, type, currency; a
 * transaction's amount, status, category, and Up-side detail) and creates no
 * duplicates. A member without a readable token is skipped rather than failing
 * the whole run, as is one whose token Up itself rejects when listing accounts
 * (revoked, expired): a failure there costs only that member's accounts,
 * reconcile, and transactions, never another member's or household's. A
 * rejection distinguishing itself as the token's own fault (401/403) also
 * disconnects the member, so they are prompted to reconnect rather than
 * retried forever; a transient failure (a 5xx, a network error) leaves the
 * connection alone and is simply retried next run.
 *
 * A joint account surfaces through both partners' tokens under the same Up id;
 * it is processed once, on its first sighting, so its shared ownership stays
 * stable rather than being rewritten by whichever member syncs last.
 *
 * Between the two, the account reconcile runs against the ids the member's token
 * just returned: it deletes that member's individually-owned Up accounts the
 * token no longer reports and flags the ones something still references. It is
 * reached only past the token read, so an unreadable token reconciles nothing.
 * A failure in it costs only that member's reconcile.
 *
 * Joint accounts (owned by neither member) surface through every partner's
 * token, so one token dropping one is no proof it was deleted in Up. They are
 * reconciled once per household after the member loop, against the union of the
 * ids the household's members' tokens returned — and only for a household where
 * every connected member in scope synced with a readable token this run, since
 * an absent joint account could otherwise just be hidden by the missing read. A
 * failure in it costs only that household's joint reconcile.
 *
 * A member's ledger pass and gift rescan are settled independently of the
 * balances and of each other: they run after the account upsert, so every
 * account a transaction can name is already in the ledger, and a failure in one
 * costs only that pass for that member.
 *
 * The category taxonomy is refreshed once per run, through the first member
 * whose token lists their accounts; a failure there is logged and the next
 * member's token tries again.
 *
 * `householdId` scopes the run to one household's connected members (a caller's
 * manual refresh); null syncs every connected member (the cron path).
 */
export async function runSync(
  deps: SyncDeps,
  householdId: string | null = null,
): Promise<SyncResult> {
  const members = membersToSync(await deps.listConnectedMembers(), householdId)
  const now = new Date()
  const giftSince = giftWindowStart(now)
  const seen = new Set<string>()
  const settledAccounts = new Set<string>()
  let accounts = 0
  let transactions = 0
  let categoriesRefreshed = false

  // Per household in scope: how many connected members it has, how many of them
  // synced with a readable token this run, and the union of the Up account ids
  // their tokens returned — the inputs the joint reconcile is gated on.
  const households = new Map<
    string,
    { connected: number; synced: number; presentExternalIds: Set<string> }
  >()
  for (const member of members) {
    const household = households.get(member.householdId) ??
      { connected: 0, synced: 0, presentExternalIds: new Set<string>() }
    household.connected += 1
    households.set(member.householdId, household)
  }

  for (const member of members) {
    const token = await deps.tokenFor(member.memberId)
    if (!token) continue

    // A token Up itself now rejects (revoked, expired) throws here. A failure
    // costs only this member's accounts, reconcile, and transactions — the rest
    // of the run, and every other member and household in it, are unaffected.
    let upAccounts: UpAccount[]
    try {
      upAccounts = await deps.listAccounts(token)
    } catch (error) {
      console.error(`Account listing failed for member ${member.memberId}:`, error)
      if (isUpAuthError(error)) {
        try {
          await deps.disconnectMember(member.memberId)
        } catch (disconnectError) {
          console.error(`Disconnecting member ${member.memberId} failed:`, disconnectError)
        }
      }
      continue
    }

    if (!categoriesRefreshed) {
      try {
        await deps.syncCategories((await deps.listCategories(token)).map(mapCategory))
        categoriesRefreshed = true
      } catch (error) {
        console.error(`Category refresh failed for member ${member.memberId}:`, error)
      }
    }

    const rows = buildAccountRows(upAccounts, member)
      .filter((row) => !seen.has(row.external_id))
    if (rows.length > 0) {
      for (const row of rows) seen.add(row.external_id)
      await deps.upsertAccounts(rows)
      accounts += rows.length
    }

    const externalIds = upAccounts.map((account) => account.id)

    // The token read succeeded: this member counts towards their household's
    // joint-reconcile guard, and their ids join its union.
    const household = households.get(member.householdId)!
    household.synced += 1
    for (const externalId of externalIds) household.presentExternalIds.add(externalId)

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

    let synced: Map<string, SyncedAccount>
    try {
      const rows = await deps.listSyncedAccounts(externalIds)
      synced = new Map(rows.map((account) => [account.external_id, account]))
    } catch (error) {
      console.error(`Resolving synced accounts failed for member ${member.memberId}:`, error)
      continue
    }

    try {
      transactions += await syncLedger(deps, member, token, synced, settledAccounts, now)
    } catch (error) {
      console.error(`Transaction sync failed for member ${member.memberId}:`, error)
    }

    try {
      transactions += await syncGiftWindow(deps, member, token, synced, giftSince)
    } catch (error) {
      console.error(`Gift transaction rescan failed for member ${member.memberId}:`, error)
    }
  }

  // Every connected member of a household synced this run, so the union of their
  // tokens' ids is authoritative for that household's joint Up accounts: drop
  // the ones no member reports any more, flag the referenced ones. A household
  // with a gap is left until a run that covers all of it. A failure here costs
  // only that household's joint reconcile.
  for (const [householdId, household] of households) {
    if (household.synced !== household.connected) continue
    try {
      await deps.reconcileJointAccounts({
        householdId,
        presentExternalIds: [...household.presentExternalIds],
      })
    } catch (error) {
      console.error(`Joint account reconcile failed for household ${householdId}:`, error)
    }
  }

  return { members: members.length, accounts, transactions }
}
