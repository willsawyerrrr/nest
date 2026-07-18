/**
 * Up Bank webhook receiver. Verifies the `X-Up-Authenticity-Signature` HMAC
 * before acting on any event, so only genuine Up deliveries reach the ledger.
 *
 * Up signs each delivery with a hex HMAC-SHA256 of the raw request body, keyed
 * by the webhook's secret (returned once when the webhook is registered and
 * stored in Supabase Vault). See https://developer.up.com.au/#callback_post_webhookURL.
 */

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

/** Hex-encodes bytes for comparison against Up's signature header. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Length-safe, constant-time comparison of two hex signature strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/** Verifies the request signature against the raw body using the webhook secret. */
async function isSignatureValid(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return timingSafeEqual(toHex(mac), signature)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

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
      void transactionId
      return new Response('Accepted', { status: 200 })
    }

    default:
      return new Response('Ignored', { status: 200 })
  }
})
