/**
 * Registering a member's Up webhook, with its I/O injected so the idempotency
 * and cap logic is unit-tested without a network or database. `up-connect`
 * registers on connect and `up-sync` for a connected member lacking one; both
 * wire the real Up client and Vault RPCs through {@link registerWithUp}.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { type CreatedUpWebhook, UpClient, type UpWebhook } from './up.ts'

/** The most webhooks Up lets one user register. */
export const UP_WEBHOOK_CAP = 10

/** The description Up shows against Nest's webhook. */
export const UP_WEBHOOK_DESCRIPTION = 'Nest'

/** The `up-webhook` function's public URL, before the member query. */
export function webhookBaseUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/up-webhook`
}

/** The URL a member's webhook delivers to: `up-webhook?m=<member_id>`. */
export function webhookUrl(supabaseUrl: string, memberId: string): string {
  return `${webhookBaseUrl(supabaseUrl)}?m=${encodeURIComponent(memberId)}`
}

export interface RegisterDeps {
  /** The webhook id stored for the member, or null when none is. */
  storedWebhookId: () => Promise<string | null>
  /** Every webhook registered with the member's token. */
  listWebhooks: () => Promise<UpWebhook[]>
  createWebhook: (url: string, description: string) => Promise<CreatedUpWebhook>
  deleteWebhook: (id: string) => Promise<void>
  /** Stores the webhook id and its secret for the member, replacing any prior pair. */
  storeWebhook: (webhookId: string, secretKey: string) => Promise<void>
}

/**
 * `existing`: the stored webhook is still registered. `registered`: a new one
 * was created and stored. `cap_reached`: the token already has
 * {@link UP_WEBHOOK_CAP} webhooks that are not Nest's, so none was created.
 */
export type RegisterOutcome = 'existing' | 'registered' | 'cap_reached'

/**
 * Ensures the member has exactly one Nest webhook at `url`, whose secret is
 * stored. Up discloses a webhook's secret only when creating it, so a Nest
 * webhook is kept only when it is the stored one at this exact URL; any other
 * pointing at `up-webhook` (left by a failed store, or an earlier registration
 * whose secret is gone) is deleted rather than reused. A webhook is created only
 * when Up's cap leaves room, and a created webhook whose store fails is deleted
 * again before the failure is rethrown. Calling it repeatedly is safe.
 */
export async function registerWebhook(url: string, deps: RegisterDeps): Promise<RegisterOutcome> {
  const base = url.split('?')[0]
  const storedId = await deps.storedWebhookId()
  const listed = await deps.listWebhooks()
  const ours = listed.filter((webhook) => webhook.attributes.url.split('?')[0] === base)
  const keep = ours.find((webhook) => webhook.id === storedId && webhook.attributes.url === url)

  for (const webhook of ours) {
    if (webhook !== keep) await deps.deleteWebhook(webhook.id)
  }
  if (keep) return 'existing'

  if (listed.length - ours.length >= UP_WEBHOOK_CAP) return 'cap_reached'

  const created = await deps.createWebhook(url, UP_WEBHOOK_DESCRIPTION)
  try {
    await deps.storeWebhook(created.id, created.secretKey)
  } catch (error) {
    await deps.deleteWebhook(created.id).catch(() => {})
    throw error
  }
  return 'registered'
}

/**
 * Registers `memberId`'s webhook with their Up `token`, reading and writing the
 * stored pair through the service-role client: `up_webhook` for the id, and the
 * `store_up_webhook` RPC for the id and its Vault secret.
 */
export function registerWithUp(
  admin: SupabaseClient,
  supabaseUrl: string,
  memberId: string,
  token: string,
): Promise<RegisterOutcome> {
  const up = new UpClient(token)
  return registerWebhook(webhookUrl(supabaseUrl, memberId), {
    storedWebhookId: async () => {
      const { data, error } = await admin
        .from('up_webhook')
        .select('webhook_id')
        .eq('member_id', memberId)
        .maybeSingle()
      if (error) throw new Error(`Failed to read the stored webhook: ${error.message}`)
      return data?.webhook_id ?? null
    },
    listWebhooks: () => up.listWebhooks(),
    createWebhook: (url, description) => up.createWebhook(url, description),
    deleteWebhook: (id) => up.deleteWebhook(id),
    storeWebhook: async (webhookId, secretKey) => {
      const { error } = await admin.rpc('store_up_webhook', {
        p_member_id: memberId,
        p_webhook_id: webhookId,
        p_secret: secretKey,
      })
      if (error) throw new Error(`Failed to store the webhook: ${error.message}`)
    },
  })
}

/**
 * Removes `memberId`'s webhook: deletes it at Up with their `token` (best
 * effort, so an unreachable Up or a revoked token never blocks a disconnect)
 * and then clears the stored id and secret through `clear_up_webhook`. Returns
 * false only when the clear fails.
 */
export async function unregisterWithUp(
  admin: SupabaseClient,
  memberId: string,
  token: string | null,
): Promise<boolean> {
  const { data } = await admin
    .from('up_webhook')
    .select('webhook_id')
    .eq('member_id', memberId)
    .maybeSingle()
  if (data?.webhook_id && token) {
    try {
      await new UpClient(token).deleteWebhook(data.webhook_id)
    } catch (error) {
      console.error(`Deleting the Up webhook for member ${memberId} failed:`, error)
    }
  }
  const { error } = await admin.rpc('clear_up_webhook', { p_member_id: memberId })
  return !error
}
