import { useCallback, useEffect, useState } from 'react'
import { useHouseholdId } from '../components/HouseholdProvider'
import { base64UrlToBytes, bytesToBase64Url } from '../lib/push'
import { supabase } from '../lib/supabase'

/**
 * What Web Push can do on the device the app is running on.
 *
 * - `checking` — the device is still being probed; nothing is offered yet.
 * - `unsupported` — the browser has no Web Push at all.
 * - `needs-install` — iOS, which delivers push only to a PWA installed to the
 *   home screen, running as an ordinary Safari tab.
 * - `denied` — notifications are blocked. Terminal: the browser will not prompt
 *   again, so no control can recover from it.
 * - `not-subscribed` / `subscribed` — this device can be turned on, or is on.
 */
export type PushStatus =
  'checking' | 'unsupported' | 'needs-install' | 'denied' | 'not-subscribed' | 'subscribed'

/** What the `push-test` function reports back about a test send. */
interface PushTestResult {
  /** Every device the member had registered when the send started. */
  devices: number
  sent: number
  /** Dead endpoints the send discovered and deleted. */
  pruned: number
  /** Devices neither reached nor pruned; the next send retries them. */
  failed: number
}

/** What `push-key` serves: the base64url VAPID public key devices subscribe with. */
interface PushKeyResult {
  publicKey: string
}

/** Which action is in flight, so each control shows its own loading state. */
export type PushAction = 'toggle' | 'test'

export interface UsePushNotificationsResult {
  status: PushStatus
  /** The action currently in flight, or null when idle. */
  pending: PushAction | null
  error: string | null
  /** What the last test send did, e.g. "Sent to 2 devices." */
  testResult: string | null
  /** Asks for permission and registers this device. Must be called from a user gesture. */
  subscribe: () => Promise<void>
  /** Drops this device's browser subscription and its stored row. */
  unsubscribe: () => Promise<void>
  /** Sends a test push to every device the signed-in member has registered. */
  sendTest: () => Promise<void>
}

const SUBSCRIBE_FAILED = 'Could not turn on notifications for this device. Try again.'
const UNSUBSCRIBE_FAILED = 'Could not turn off notifications for this device. Try again.'
const TEST_FAILED = 'Could not send the test notification. Try again.'
const PERMISSION_REFUSED = 'Notifications were not allowed, so this device stays off.'

/**
 * Whether the device is an iPhone or iPad. iPadOS reports itself as a Mac, so it
 * is picked out by the touch points a desktop does not have.
 */
function isIos(): boolean {
  const { userAgent, maxTouchPoints } = navigator
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

/** Whether the app is running as an installed PWA rather than a browser tab. */
function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function hasPushApis(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * Probes what this device can do, in the order the answers foreclose one
 * another: iOS outside an installed PWA can be fixed by installing, so it is
 * reported ahead of the bare API check that would otherwise call it unsupported;
 * a blocked permission is terminal, so it is reported ahead of the subscription
 * lookup. Anything unexpected reads as unsupported rather than leaving the UI
 * stuck probing.
 */
async function probeStatus(): Promise<PushStatus> {
  try {
    if (isIos() && !isInstalled()) {
      return 'needs-install'
    }
    if (!hasPushApis()) {
      return 'unsupported'
    }
    if (Notification.permission === 'denied') {
      return 'denied'
    }
    const registration = await navigator.serviceWorker.ready
    return (await registration.pushManager.getSubscription()) ? 'subscribed' : 'not-subscribed'
  } catch {
    return 'unsupported'
  }
}

/** Records a browser subscription as this device's `push_subscription` row. */
async function storeSubscription(
  subscription: PushSubscription,
  householdId: string,
  memberId: string,
): Promise<void> {
  const p256dh = subscription.getKey('p256dh')
  const auth = subscription.getKey('auth')
  if (!p256dh || !auth) {
    throw new Error('The browser subscription is missing its encryption keys')
  }
  // Keyed on the endpoint, so a device that re-subscribes replaces its own row
  // rather than accumulating dead ones.
  const { error } = await supabase.from('push_subscription').upsert(
    {
      household_id: householdId,
      member_id: memberId,
      endpoint: subscription.endpoint,
      p256dh: bytesToBase64Url(p256dh),
      auth: bytesToBase64Url(auth),
    },
    { onConflict: 'endpoint' },
  )
  if (error) {
    throw error
  }
}

function devices(count: number): string {
  return `${count} ${count === 1 ? 'device' : 'devices'}`
}

/**
 * Reads the test send's counts back as a sentence — what it reached, what it
 * pruned as dead, and what it could not reach — or throws when the send reported
 * nothing at all.
 */
function describeTestResult(result: PushTestResult | null): string {
  if (!result) {
    throw new Error('The test send reported nothing')
  }
  if (result.devices === 0) {
    return 'No devices are registered for notifications.'
  }
  const parts = [result.sent === 0 ? 'Reached no devices.' : `Sent to ${devices(result.sent)}.`]
  if (result.pruned > 0) {
    parts.push(`Removed ${devices(result.pruned)} that had unsubscribed.`)
  }
  if (result.failed > 0) {
    parts.push(`Could not reach ${devices(result.failed)}.`)
  }
  return parts.join(' ')
}

/**
 * Opts this device in and out of Web Push, and fires a test push to prove the
 * chain end to end.
 *
 * `status` is the whole state model: it distinguishes a browser that cannot do
 * push at all from an iOS tab that only needs installing, and a blocked
 * permission from a device simply switched off, so the UI can say which it is
 * rather than offering a control that would do nothing. Subscribing asks for
 * permission first and so must run from a user gesture — iOS grants nothing
 * otherwise.
 *
 * The VAPID public key comes from the `push-key` edge function rather than a
 * build-time variable, so rotating it needs no rebuild, and the test push goes
 * through `push-test`, which reports how many devices it reached and how many
 * dead endpoints it pruned. The device's own row lives in `push_subscription`,
 * RLS-scoped to the member, keyed on its endpoint.
 */
export function usePushNotifications(memberId: string | null): UsePushNotificationsResult {
  const householdId = useHouseholdId()
  const [status, setStatus] = useState<PushStatus>('checking')
  const [pending, setPending] = useState<PushAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void probeStatus().then((next) => {
      if (active) {
        setStatus(next)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const subscribe = useCallback(async () => {
    setPending('toggle')
    setError(null)
    setTestResult(null)
    try {
      if (memberId === null) {
        throw new Error('The signed-in user has no member row to register against')
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        // A refusal is not an error to retry: 'denied' is terminal, and a
        // dismissed prompt leaves the device simply off.
        setStatus(permission === 'denied' ? 'denied' : 'not-subscribed')
        setError(PERMISSION_REFUSED)
        return
      }

      const { data, error: keyError } = await supabase.functions.invoke<PushKeyResult>('push-key', {
        body: {},
      })
      if (keyError || !data) {
        throw keyError ?? new Error('The push key was not served')
      }

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(data.publicKey),
      })

      try {
        await storeSubscription(subscription, householdId, memberId)
      } catch (cause) {
        // A subscription the server never recorded would receive nothing, so it
        // is dropped again rather than left behind as a phantom opt-in.
        await subscription.unsubscribe()
        throw cause
      }
      setStatus('subscribed')
    } catch {
      setError(SUBSCRIBE_FAILED)
    } finally {
      setPending(null)
    }
  }, [householdId, memberId])

  const unsubscribe = useCallback(async () => {
    setPending('toggle')
    setError(null)
    setTestResult(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        setStatus('not-subscribed')
        return
      }
      // The row goes first: a failure there leaves both halves intact and
      // reportable, whereas dropping the browser subscription first would
      // orphan a row the server would keep pushing to.
      const { error: deleteError } = await supabase
        .from('push_subscription')
        .delete()
        .eq('endpoint', subscription.endpoint)
      if (deleteError) {
        throw deleteError
      }
      if (!(await subscription.unsubscribe())) {
        throw new Error('The browser kept the subscription')
      }
      setStatus('not-subscribed')
    } catch {
      setError(UNSUBSCRIBE_FAILED)
    } finally {
      setPending(null)
    }
  }, [])

  const sendTest = useCallback(async () => {
    setPending('test')
    setError(null)
    setTestResult(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<PushTestResult>(
        'push-test',
        { body: {} },
      )
      if (invokeError) {
        throw invokeError
      }
      setTestResult(describeTestResult(data))
    } catch {
      setError(TEST_FAILED)
    } finally {
      setPending(null)
    }
  }, [])

  return { status, pending, error, testResult, subscribe, unsubscribe, sendTest }
}
