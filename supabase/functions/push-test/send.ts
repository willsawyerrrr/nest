/**
 * The test-push flow, with its I/O injected so the decision logic is unit-tested
 * without a network, database, or push service. `index.ts` wires the real member
 * resolution, device reads, Web Push and APNs senders, and prunes.
 *
 * The flow only ever touches the caller's OWN devices: the member comes from the
 * Authorization JWT, never the body, and the subscription read is keyed on it.
 */

import type { ApnsDevice, ApnsSender } from '../_shared/apns.ts'
import type { FlowResult, MemberOutcome } from '../up-connect/connect.ts'
import type { DeliveryOutcome, PushDevice, PushPayload, PushSender } from '../_shared/webpush.ts'

export type { ApnsDevice, ApnsSender, DeliveryOutcome, PushDevice, PushPayload, PushSender }

export interface PushTestDeps {
  /** Resolves the caller's own member id, or an error outcome. */
  resolveMember: () => Promise<MemberOutcome>
  /** The member's own subscriptions, or null when they could not be read. */
  loadDevices: (memberId: string) => Promise<PushDevice[] | null>
  /** A sender bound to the configured VAPID keys, or null when unconfigured. */
  loadSender: () => Promise<PushSender | null>
  /** Deletes the given subscription rows; true when all were removed. */
  prune: (ids: string[]) => Promise<boolean>
  /** The member's own native installs, or null when they could not be read. */
  loadApnsDevices: (memberId: string) => Promise<ApnsDevice[] | null>
  /** A sender bound to the configured APNs credentials, or null when unconfigured. */
  loadApnsSender: () => Promise<ApnsSender | null>
  /** Deletes the given APNs device rows; true when all were removed. */
  pruneApns: (ids: string[]) => Promise<boolean>
}

/** The fixed payload of a test send; `/household` is where opt-in lives. */
export const TEST_PAYLOAD: PushPayload = {
  title: 'Nest test notification',
  body: 'Push notifications are working on this device.',
  url: '/household',
}

/** What the caller is told: enough to report the send honestly. */
export type PushTestSummary = {
  /** Devices the member has opted in: Web Push subscriptions plus native installs. */
  devices: number
  /** Deliveries the push service accepted. */
  sent: number
  /** Dead subscriptions removed this pass. */
  pruned: number
  /** Everything neither sent nor pruned — retried on the next send. */
  failed: number
  /** Why an unreachable device failed, when the push service said; omitted when none did. */
  failures?: PushTestFailure[]
}

export type PushTestFailure = { channel: 'web' | 'apns'; reason: string }

export async function runPushTest(deps: PushTestDeps): Promise<FlowResult> {
  const outcome = await deps.resolveMember()
  if (outcome.error || !outcome.memberId) {
    const error = outcome.error ?? { status: 404, message: 'No household membership for this user' }
    return { status: error.status, body: { error: error.message } }
  }

  const [webDevices, apnsDevices] = await Promise.all([
    deps.loadDevices(outcome.memberId),
    deps.loadApnsDevices(outcome.memberId),
  ])
  if (!webDevices || !apnsDevices) {
    return { status: 500, body: { error: 'Could not load your devices.' } }
  }
  const total = webDevices.length + apnsDevices.length
  // No devices needs no keys, so answer before asking Vault for them.
  if (total === 0) {
    return { status: 200, body: summary(0, 0, 0) }
  }

  const [sendWeb, sendApns] = await Promise.all([
    webDevices.length > 0 ? deps.loadSender() : null,
    apnsDevices.length > 0 ? deps.loadApnsSender() : null,
  ])
  // Devices of a kind with no credentials are unreachable (counted as failed),
  // but the caller is only told push is unconfigured when nothing could be sent.
  if (!sendWeb && !sendApns) {
    return { status: 503, body: { error: 'Push notifications are not configured.' } }
  }

  const [web, apns] = await Promise.all([
    attempt(webDevices, sendWeb, deps.prune),
    attempt(apnsDevices, sendApns, deps.pruneApns),
  ])
  return {
    status: 200,
    body: summary(total, web.sent + apns.sent, web.pruned + apns.pruned, [
      ...web.failures.map((reason) => ({ channel: 'web' as const, reason })),
      ...apns.failures.map((reason) => ({ channel: 'apns' as const, reason })),
    ]),
  }
}

/**
 * Attempt every device of one kind. One failing endpoint must not deny the
 * others, so a throwing sender counts as a transient failure.
 */
async function attempt<D extends { id: string }>(
  devices: D[],
  send: ((device: D, payload: PushPayload) => Promise<DeliveryOutcome>) | null,
  prune: (ids: string[]) => Promise<boolean>,
): Promise<{ sent: number; pruned: number; failures: string[] }> {
  if (!send || devices.length === 0) return { sent: 0, pruned: 0, failures: [] }

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
  const pruned = goneIds.length > 0 && (await prune(goneIds)) ? goneIds.length : 0
  const failures = outcomes.flatMap((result) =>
    !result.delivered && !result.gone && result.reason ? [result.reason] : []
  )
  return { sent, pruned, failures }
}

function summary(
  devices: number,
  sent: number,
  pruned: number,
  failures: PushTestFailure[] = [],
): PushTestSummary {
  const base = { devices, sent, pruned, failed: devices - sent - pruned }
  return failures.length > 0 ? { ...base, failures } : base
}
