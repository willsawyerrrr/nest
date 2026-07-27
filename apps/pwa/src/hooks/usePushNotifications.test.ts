import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import { makeSupabaseBuilder, type SupabaseBuilder } from '../test/supabaseBuilder'
import { usePushNotifications } from './usePushNotifications'

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), functions: { invoke: vi.fn() } },
}))

const invoke = vi.mocked(supabase.functions.invoke)
const from = vi.mocked(supabase.from)

/** "hello" as base64url — a stand-in VAPID key whose bytes are easy to assert. */
const PUBLIC_KEY = 'aGVsbG8'
const ENDPOINT = 'https://push.example/abc'

/** The `p256dh` and `auth` bytes a fake subscription hands back. */
const P256DH_BYTES = new Uint8Array([251, 255])
const AUTH_BYTES = new Uint8Array([104, 101, 108, 108, 111])

interface FakeSubscription {
  endpoint: string
  getKey: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
}

function makeSubscription(overrides: Partial<FakeSubscription> = {}): FakeSubscription {
  return {
    endpoint: ENDPOINT,
    getKey: vi.fn((name: string) => (name === 'p256dh' ? P256DH_BYTES.buffer : AUTH_BYTES.buffer)),
    unsubscribe: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

const pushManager = {
  getSubscription: vi.fn(),
  subscribe: vi.fn(),
}

let builder: SupabaseBuilder

/**
 * Stands the happy-dom globals up as a browser that supports Web Push: a ready
 * service-worker registration with a push manager, and a `Notification`
 * permission API.
 */
function givenPushCapableBrowser({
  permission = 'default',
  userAgent = 'Mozilla/5.0 (Macintosh)',
  maxTouchPoints = 0,
  standalone = false,
}: {
  permission?: NotificationPermission
  userAgent?: string
  maxTouchPoints?: number
  standalone?: boolean
} = {}) {
  const requestPermission = vi.fn().mockResolvedValue('granted')
  Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
  Object.defineProperty(window, 'Notification', {
    value: { permission, requestPermission },
    configurable: true,
  })
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  })
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true })
  return { requestPermission }
}

function removePushApis() {
  Reflect.deleteProperty(window, 'PushManager')
  Reflect.deleteProperty(window, 'Notification')
  Reflect.deleteProperty(navigator, 'serviceWorker')
}

function renderPush(memberId: string | null = 'm1') {
  return renderHook(() => usePushNotifications('h1', memberId))
}

/** A `push-test` summary body, defaulting every count the test does not set. */
function summary(counts: { devices?: number; sent?: number; pruned?: number; failed?: number }) {
  return { devices: 0, sent: 0, pruned: 0, failed: 0, ...counts }
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { publicKey: PUBLIC_KEY }, error: null })
  pushManager.getSubscription.mockReset().mockResolvedValue(null)
  pushManager.subscribe.mockReset().mockResolvedValue(makeSubscription())
  builder = makeSupabaseBuilder(['upsert', 'delete', 'eq'])
  builder.result = { data: null, error: null }
  from.mockReset()
  from.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>)
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Macintosh)',
    configurable: true,
  })
})

afterEach(() => {
  removePushApis()
})

describe('usePushNotifications status', () => {
  it('reports an unsupported browser', async () => {
    removePushApis()
    const { result } = renderPush()

    expect(result.current.status).toBe('checking')
    await waitFor(() => expect(result.current.status).toBe('unsupported'))
  })

  it('tells an iOS browser tab to install to the home screen first', async () => {
    givenPushCapableBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })
    const { result } = renderPush()

    await waitFor(() => expect(result.current.status).toBe('needs-install'))
  })

  it('treats a touch-capable iPad reporting itself as a Mac as iOS', async () => {
    givenPushCapableBrowser({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 })
    const { result } = renderPush()

    await waitFor(() => expect(result.current.status).toBe('needs-install'))
  })

  it('probes an installed iOS PWA normally', async () => {
    givenPushCapableBrowser({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      standalone: true,
    })
    const { result } = renderPush()

    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))
  })

  it('treats a standalone display mode as installed', async () => {
    givenPushCapableBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('standalone'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia
    const { result } = renderPush()

    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))
  })

  it('reports a blocked permission as terminal', async () => {
    givenPushCapableBrowser({ permission: 'denied' })
    const { result } = renderPush()

    await waitFor(() => expect(result.current.status).toBe('denied'))
    expect(pushManager.getSubscription).not.toHaveBeenCalled()
  })

  it('reports an already-registered device as subscribed', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    pushManager.getSubscription.mockResolvedValue(makeSubscription())
    const { result } = renderPush()

    await waitFor(() => expect(result.current.status).toBe('subscribed'))
  })

  it('falls back to unsupported when probing throws', async () => {
    givenPushCapableBrowser()
    pushManager.getSubscription.mockRejectedValue(new Error('no push service'))
    const { result } = renderPush()

    await waitFor(() => expect(result.current.status).toBe('unsupported'))
  })

  it('ignores a probe that lands after unmount', async () => {
    givenPushCapableBrowser()
    const { result, unmount } = renderPush()

    unmount()
    await Promise.resolve()

    expect(result.current.status).toBe('checking')
  })
})

describe('usePushNotifications subscribe', () => {
  it('asks for permission, fetches the key, and upserts the device row', async () => {
    const { requestPermission } = givenPushCapableBrowser()
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('push-key', { body: {} })
    // The base64url key is decoded to the bytes `subscribe` requires.
    const options = pushManager.subscribe.mock.calls[0]?.[0]
    expect(options.userVisibleOnly).toBe(true)
    expect([...options.applicationServerKey]).toEqual([104, 101, 108, 108, 111])
    expect(from).toHaveBeenCalledWith('push_subscription')
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        household_id: 'h1',
        member_id: 'm1',
        endpoint: ENDPOINT,
        p256dh: '-_8',
        auth: 'aGVsbG8',
      },
      { onConflict: 'endpoint' },
    )
    expect(result.current.status).toBe('subscribed')
    expect(result.current.error).toBeNull()
    expect(result.current.pending).toBeNull()
  })

  it('reports the toggle as pending while subscribing', async () => {
    givenPushCapableBrowser()
    let resolveSubscribe!: (value: FakeSubscription) => void
    pushManager.subscribe.mockReturnValue(
      new Promise<FakeSubscription>((resolve) => {
        resolveSubscribe = resolve
      }),
    )
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.subscribe()
    })
    await waitFor(() => expect(result.current.pending).toBe('toggle'))

    await act(async () => {
      resolveSubscribe(makeSubscription())
      await pending
    })

    expect(result.current.pending).toBeNull()
    expect(result.current.status).toBe('subscribed')
  })

  it('treats a blocked prompt as terminal without registering anything', async () => {
    const { requestPermission } = givenPushCapableBrowser()
    requestPermission.mockResolvedValue('denied')
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(result.current.status).toBe('denied')
    expect(result.current.error).toMatch(/not allowed/i)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('leaves the device off when the prompt is dismissed', async () => {
    const { requestPermission } = givenPushCapableBrowser()
    requestPermission.mockResolvedValue('default')
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(result.current.status).toBe('not-subscribed')
    expect(result.current.error).toMatch(/not allowed/i)
  })

  it('surfaces a failure when the key cannot be fetched', async () => {
    givenPushCapableBrowser()
    invoke.mockResolvedValue({ data: null, error: new Error('no key') })
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(result.current.error).toMatch(/could not turn on/i)
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(result.current.status).toBe('not-subscribed')
  })

  it('surfaces a failure when the key response is empty', async () => {
    givenPushCapableBrowser()
    invoke.mockResolvedValue({ data: null, error: null })
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(result.current.error).toMatch(/could not turn on/i)
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('drops the browser subscription again when the row cannot be stored', async () => {
    givenPushCapableBrowser()
    const subscription = makeSubscription()
    pushManager.subscribe.mockResolvedValue(subscription)
    builder.result = { data: null, error: new Error('rls') }
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('not-subscribed')
    expect(result.current.error).toMatch(/could not turn on/i)
  })

  it('drops a subscription whose encryption keys are missing', async () => {
    givenPushCapableBrowser()
    const subscription = makeSubscription({ getKey: vi.fn().mockReturnValue(null) })
    pushManager.subscribe.mockResolvedValue(subscription)
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(builder.upsert).not.toHaveBeenCalled()
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(result.current.error).toMatch(/could not turn on/i)
  })

  it('refuses to register when the signed-in user has no member row', async () => {
    givenPushCapableBrowser()
    const { result } = renderPush(null)
    await waitFor(() => expect(result.current.status).toBe('not-subscribed'))

    await act(async () => {
      await result.current.subscribe()
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/could not turn on/i)
  })
})

describe('usePushNotifications unsubscribe', () => {
  it('deletes the device row and drops the browser subscription', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    const subscription = makeSubscription()
    pushManager.getSubscription.mockResolvedValue(subscription)
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('subscribed'))

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(from).toHaveBeenCalledWith('push_subscription')
    expect(builder.delete).toHaveBeenCalledOnce()
    expect(builder.eq).toHaveBeenCalledWith('endpoint', ENDPOINT)
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('not-subscribed')
    expect(result.current.error).toBeNull()
  })

  it('keeps the browser subscription when its row cannot be deleted', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    const subscription = makeSubscription()
    pushManager.getSubscription.mockResolvedValue(subscription)
    builder.result = { data: null, error: new Error('rls') }
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('subscribed'))

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(subscription.unsubscribe).not.toHaveBeenCalled()
    expect(result.current.status).toBe('subscribed')
    expect(result.current.error).toMatch(/could not turn off/i)
  })

  it('reports a browser that keeps the subscription after its row is gone', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    const subscription = makeSubscription({ unsubscribe: vi.fn().mockResolvedValue(false) })
    pushManager.getSubscription.mockResolvedValue(subscription)
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('subscribed'))

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(result.current.status).toBe('subscribed')
    expect(result.current.error).toMatch(/could not turn off/i)
  })

  it('settles on off when the browser holds no subscription', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    pushManager.getSubscription.mockResolvedValueOnce(makeSubscription()).mockResolvedValue(null)
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('subscribed'))

    await act(async () => {
      await result.current.unsubscribe()
    })

    expect(builder.delete).not.toHaveBeenCalled()
    expect(result.current.status).toBe('not-subscribed')
  })
})

describe('usePushNotifications sendTest', () => {
  it('reports how many devices the test reached', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    pushManager.getSubscription.mockResolvedValue(makeSubscription())
    invoke.mockResolvedValue({ data: summary({ devices: 2, sent: 2 }), error: null })
    const { result } = renderPush()
    await waitFor(() => expect(result.current.status).toBe('subscribed'))

    await act(async () => {
      await result.current.sendTest()
    })

    expect(invoke).toHaveBeenCalledWith('push-test', { body: {} })
    expect(result.current.testResult).toBe('Sent to 2 devices.')
    expect(result.current.error).toBeNull()
  })

  it('reports a single device and the dead endpoint it pruned', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    invoke.mockResolvedValue({ data: summary({ devices: 2, sent: 1, pruned: 1 }), error: null })
    const { result } = renderPush()

    await act(async () => {
      await result.current.sendTest()
    })

    expect(result.current.testResult).toBe(
      'Sent to 1 device. Removed 1 device that had unsubscribed.',
    )
  })

  it('reports devices it could not reach alongside the ones it did', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    invoke.mockResolvedValue({
      data: summary({ devices: 6, sent: 3, pruned: 2, failed: 1 }),
      error: null,
    })
    const { result } = renderPush()

    await act(async () => {
      await result.current.sendTest()
    })

    expect(result.current.testResult).toBe(
      'Sent to 3 devices. Removed 2 devices that had unsubscribed. Could not reach 1 device.',
    )
  })

  it('says so when it reached none of the registered devices', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    invoke.mockResolvedValue({ data: summary({ devices: 2, failed: 2 }), error: null })
    const { result } = renderPush()

    await act(async () => {
      await result.current.sendTest()
    })

    expect(result.current.testResult).toBe('Reached no devices. Could not reach 2 devices.')
  })

  it('says so when no device is registered at all', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    invoke.mockResolvedValue({ data: summary({}), error: null })
    const { result } = renderPush()

    await act(async () => {
      await result.current.sendTest()
    })

    expect(result.current.testResult).toBe('No devices are registered for notifications.')
  })

  it('surfaces a failed send', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    const { result } = renderPush()

    await act(async () => {
      await result.current.sendTest()
    })

    expect(result.current.testResult).toBeNull()
    expect(result.current.error).toMatch(/could not send/i)
  })

  it('surfaces a send that reports nothing back', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    invoke.mockResolvedValue({ data: null, error: null })
    const { result } = renderPush()

    await act(async () => {
      await result.current.sendTest()
    })

    expect(result.current.error).toMatch(/could not send/i)
  })

  it('reports the test as pending while it is in flight', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    let resolveInvoke!: (value: { data: unknown; error: null }) => void
    invoke.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve
      }) as ReturnType<typeof supabase.functions.invoke>,
    )
    const { result } = renderPush()

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.sendTest()
    })
    await waitFor(() => expect(result.current.pending).toBe('test'))

    await act(async () => {
      resolveInvoke({ data: summary({ devices: 1, sent: 1 }), error: null })
      await pending
    })

    expect(result.current.pending).toBeNull()
    expect(result.current.testResult).toBe('Sent to 1 device.')
  })

  it('clears a previous result when the next action starts', async () => {
    givenPushCapableBrowser({ permission: 'granted' })
    invoke.mockResolvedValue({ data: summary({ devices: 1, sent: 1 }), error: null })
    const { result } = renderPush()
    await act(async () => {
      await result.current.sendTest()
    })
    expect(result.current.testResult).not.toBeNull()

    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    await act(async () => {
      await result.current.sendTest()
    })

    expect(result.current.testResult).toBeNull()
  })
})
