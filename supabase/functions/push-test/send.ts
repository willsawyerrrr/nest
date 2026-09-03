/**
 * The test-push flow, with its I/O injected so the decision logic is unit-tested
 * without a network, database, or push service. `index.ts` wires the real member
 * resolution, subscription read, Web Push sender, and prune.
 *
 * The flow only ever touches the caller's OWN devices: the member comes from the
 * Authorization JWT, never the body, and the subscription read is keyed on it.
 */

import type { FlowResult, MemberOutcome } from '../up-connect/connect.ts'
import type { DeliveryOutcome, PushDevice, PushPayload, PushSender } from '../_shared/webpush.ts'

export type { DeliveryOutcome, PushDevice, PushPayload, PushSender }

export interface PushTestDeps {
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /** The member's own subscriptions, or null when they could not be read. */
  loadDevices: (memberId: string) => Promise<PushDevice[] | null>
  /** A sender bound to the configured VAPID keys, or null when unconfigured. */
  loadSender: () => Promise<PushSender | null>
  /** Deletes the given subscription rows; true when all were removed. */
  prune: (ids: string[]) => Promise<boolean>
}

/** The fixed payload of a test send; `/household` is where opt-in lives. */
export const TEST_PAYLOAD: PushPayload = {
  title: 'Nest test notification',
  body: 'Push notifications are working on this device.',
  url: '/household',
}

/** What the caller is told: enough to report the send honestly. */
export type PushTestSummary = {
  /** Subscriptions the member has opted in. */
  devices: number
  /** Deliveries the push service accepted. */
  sent: number
  /** Dead subscriptions removed this pass. */
  pruned: number
  /** Everything neither sent nor pruned — retried on the next send. */
  failed: number
}

export async function runPushTest(deps: PushTestDeps): Promise<FlowResult> {
  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ?? { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  const devices = await deps.loadDevices(outcome.memberId)
  if (!devices) {
    return { status: 500, body: { error: 'Could not load your devices.' } }
  }
  // No devices needs no keys, so answer before asking Vault for them.
  if (devices.length === 0) {
    return { status: 200, body: summary(0, 0, 0) }
  }

  const send = await deps.loadSender()
  if (!send) {
    return { status: 503, body: { error: 'Push notifications are not configured.' } }
  }

  // Every device is attempted; one failing endpoint must not deny the others.
  const outcomes = await Promise.all(
    devices.map(async (device) => {
      try {
        return await send(device, TEST_PAYLOAD)
      } catch {
        return { delivered: false, gone: false } as DeliveryOutcome
      }
    }),
  )

  const sent = outcomes.filter((result) => result.delivered).length
  const goneIds = devices
    .filter((_, index) => {
      const result = outcomes[index]
      return !result.delivered && result.gone
    })
    .map((device) => device.id)

  // A failed prune leaves the rows in place, so they count as failures rather
  // than as pruned; the next send retries the delete.
  const pruned = goneIds.length > 0 && (await deps.prune(goneIds)) ? goneIds.length : 0

  return { status: 200, body: summary(devices.length, sent, pruned) }
}

function summary(devices: number, sent: number, pruned: number): PushTestSummary {
  return { devices, sent, pruned, failed: devices - sent - pruned }
}
