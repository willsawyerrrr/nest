/**
 * Up Bank webhook receiver. Verifies the `X-Up-Authenticity-Signature` HMAC
 * before acting on any event, so only genuine Up deliveries reach the ledger.
 *
 * Up signs each delivery with a hex HMAC-SHA256 of the raw request body, keyed
 * by the webhook's secret (returned once when the webhook is registered and
 * stored in Supabase Vault). See https://developer.up.com.au/#callback_post_webhookURL.
 */

import { requirePost } from '../_shared/http.ts'
import { isSignatureValid } from './signature.ts'

const SIGNATURE_HEADER = 'X-Up-Authenticity-Signature'

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

Deno.serve(async (request) => {
  // Server-to-server, so no CORS preflight — only the shared method guard.
  const methodError = requirePost(request)
  if (methodError) return methodError

  const secret = Deno.env.get('UP_WEBHOOK_SECRET')
  if (!secret) {
    return new Response('Webhook secret not configured', { status: 500 })
  }

  const signature = request.headers.get(SIGNATURE_HEADER)
  const rawBody = await request.text()
  if (!signature || !(await isSignatureValid(rawBody, signature, secret))) {
    return new Response('Invalid signature', { status: 401 })
  }

  const event = JSON.parse(rawBody) as UpWebhookEvent
  const eventType = event.data.attributes.eventType

  switch (eventType) {
    case 'PING':
      return new Response('OK', { status: 200 })

    case 'TRANSACTION_CREATED':
    case 'TRANSACTION_SETTLED':
    case 'TRANSACTION_DELETED': {
      const transactionId = event.data.relationships.transaction?.data?.id
      // TODO: Fetch the transaction from Up via _shared/up.ts (the member's
      // token lives in Vault), map it, and upsert into public.transactions with
      // source = 'up' and external_id = transactionId, deduping on
      // (source, external_id). TRANSACTION_DELETED should remove the matching
      // row. Writes use a service-role client so RLS is bypassed server-side.
      //
      // That TODO is the general ledger. The one slice already ingested — the
      // gift-category transactions the Gifts screen links purchases from — comes
      // from the `up-sync` poll instead, and belongs there: Up raises no event
      // when someone recategorises a transaction, so only a rescanned trailing
      // window sees a purchase categorised as a gift after the fact.
      void transactionId
      return new Response('Accepted', { status: 200 })
    }

    default:
      return new Response('Ignored', { status: 200 })
  }
})
