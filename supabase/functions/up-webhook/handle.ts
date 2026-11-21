/**
 * The webhook delivery flow, with its I/O injected so verification and routing
 * are unit-tested without a network or database. `index.ts` wires the real
 * Vault reads, Up client, and ledger RPCs.
 */

import { isUpAuthError, type UpTransaction } from '../_shared/up.ts'
import { mapTransaction, type SyncedAccount, type TransactionUpsert } from '../up-sync/map.ts'
import type { SyncedTransaction } from '../up-sync/sync.ts'
import { isSignatureValid } from './signature.ts'

/** The webhook event types Up delivers. */
type UpEventType = 'PING' | 'TRANSACTION_CREATED' | 'TRANSACTION_SETTLED' | 'TRANSACTION_DELETED'

/** A webhook delivery payload (subset of the JSON:API shape). */
interface UpWebhookEvent {
  readonly data: {
    readonly attributes: { readonly eventType: UpEventType }
    readonly relationships: {
      readonly transaction?: { readonly data: { readonly id: string } | null }
    }
  }
}

/** One delivery as it reached the function. */
export interface Delivery {
  /** The `m` query parameter naming whose webhook this is. */
  memberId: string | null
  /** The `X-Up-Authenticity-Signature` header. */
  signature: string | null
  rawBody: string
}

export interface DeliveryDeps {
  /** The member's webhook secret, or null when none is stored. */
  secretFor: (memberId: string) => Promise<string | null>
  /** The member's household, or null when the member is gone. */
  householdFor: (memberId: string) => Promise<string | null>
  /** The member's Up token, or null when none is stored. */
  tokenFor: (memberId: string) => Promise<string | null>
  /** Reads one Up transaction, or null when Up no longer has it. */
  getTransaction: (token: string, id: string) => Promise<UpTransaction | null>
  /** Resolves a household's local Up account by its Up id, or null when unsynced. */
  accountFor: (householdId: string, upAccountId: string) => Promise<SyncedAccount | null>
  syncTransactions: (householdId: string, rows: TransactionUpsert[]) => Promise<SyncedTransaction[]>
  /** Deletes a household's Up rows Up no longer has, keeping any a gift purchase links. */
  deleteTransactions: (householdId: string, externalIds: string[]) => Promise<void>
}

export interface DeliveryResult {
  status: number
  body: string
  /** The ledger rows this delivery newly inserted (not ones it updated). */
  insertedIds: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function result(status: number, body: string, insertedIds: string[] = []): DeliveryResult {
  return { status, body, insertedIds }
}

/**
 * Handles one Up delivery for the member its URL names.
 *
 * The member's own secret verifies the HMAC before anything else is read, and
 * an unknown member, a missing secret, or a bad signature are one
 * indistinguishable `401`. `PING` is a bare `200`. `TRANSACTION_CREATED` and
 * `TRANSACTION_SETTLED` re-read the transaction with the member's token, map it
 * as `up-sync` does, and upsert it through `sync_up_transactions`, so a joint
 * account's two deliveries (one per member's webhook) collapse to one row; a
 * transaction on an account not yet synced is skipped for the poll to land.
 * `TRANSACTION_DELETED` deletes the row unless a gift purchase links it.
 *
 * A failure retrying could fix (the database, an Up outage or rate limit) is a
 * `500`, so Up redelivers; one it could not (a token Up rejects, a member
 * without one) is acknowledged with a `200` and logged.
 */
export async function handleDelivery(
  delivery: Delivery,
  deps: DeliveryDeps,
): Promise<DeliveryResult> {
  const { memberId, signature, rawBody } = delivery
  if (!memberId || !UUID.test(memberId) || !signature) return result(401, 'Unauthorized')

  let secret: string | null
  try {
    secret = await deps.secretFor(memberId)
  } catch (error) {
    console.error(`Reading the webhook secret for member ${memberId} failed:`, error)
    return result(500, 'Error')
  }
  if (!secret || !(await isSignatureValid(rawBody, signature, secret))) {
    return result(401, 'Unauthorized')
  }

  let event: UpWebhookEvent
  try {
    event = JSON.parse(rawBody) as UpWebhookEvent
  } catch {
    return result(400, 'Invalid body')
  }
  const eventType = event.data?.attributes?.eventType
  if (eventType === 'PING') return result(200, 'OK')
  if (
    eventType !== 'TRANSACTION_CREATED' && eventType !== 'TRANSACTION_SETTLED' &&
    eventType !== 'TRANSACTION_DELETED'
  ) {
    return result(200, 'Ignored')
  }
  const transactionId = event.data.relationships?.transaction?.data?.id
  if (!transactionId) return result(400, 'Invalid body')

  try {
    const householdId = await deps.householdFor(memberId)
    if (!householdId) return result(200, 'Ignored')

    if (eventType === 'TRANSACTION_DELETED') {
      await deps.deleteTransactions(householdId, [transactionId])
      return result(200, 'OK')
    }

    const token = await deps.tokenFor(memberId)
    if (!token) return result(200, 'Ignored')
    const transaction = await deps.getTransaction(token, transactionId)
    if (!transaction) return result(200, 'Ignored')

    const upAccountId = transaction.relationships.account.data.id
    const account = await deps.accountFor(householdId, upAccountId)
    const row = account && mapTransaction(transaction, new Map([[upAccountId, account]]))
    if (!row) return result(200, 'Ignored')

    const synced = await deps.syncTransactions(householdId, [row])
    return result(200, 'OK', synced.filter((tx) => tx.inserted).map((tx) => tx.id))
  } catch (error) {
    console.error(`Handling ${eventType} for member ${memberId} failed:`, error)
    return isUpAuthError(error) ? result(200, 'Ignored') : result(500, 'Error')
  }
}
