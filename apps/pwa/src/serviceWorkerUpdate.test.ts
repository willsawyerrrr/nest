import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { applyLatestVersion } from './serviceWorkerUpdate'

/** A service worker whose lifecycle transitions the test drives by hand. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installed'
  postMessage = vi.fn()

  /** Moves to `state` and fires the `statechange` the real worker would. */
  changeState(state: ServiceWorkerState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

/** A `ServiceWorkerContainer` stand-in that also dispatches `controllerchange`. */
class FakeContainer extends EventTarget {
  getRegistration = vi.fn()
  getRegistrations = vi.fn()
}

function fakeRegistration(waiting: FakeWorker | null) {
  return { waiting, unregister: vi.fn().mockResolvedValue(true) }
}

/** Publishes `navigator.serviceWorker` backed by a container resolving `registration`. */
function installServiceWorker(registration: unknown) {
  const container = new FakeContainer()
  container.getRegistration.mockResolvedValue(registration)
  container.getRegistrations.mockResolvedValue(registration ? [registration] : [])
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  return container
}

/** Publishes a `caches` holding `keys`, so the fallback has something to wipe. */
function installCaches(keys: string[] = ['precache-v1', 'assets']) {
  const storage = {
    keys: vi.fn().mockResolvedValue(keys),
    delete: vi.fn().mockResolvedValue(true),
  }
  Object.defineProperty(window, 'caches', { value: storage, configurable: true })
  return storage
}

let reload: MockInstance<() => void>

beforeEach(() => {
  reload = vi.spyOn(location, 'reload').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  Reflect.deleteProperty(window, 'caches')
})

describe('applyLatestVersion', () => {
  it('activates a waiting worker and reloads onto its precache, wiping nothing', async () => {
    const waiting = new FakeWorker()
    const registration = fakeRegistration(waiting)
    const container = installServiceWorker(registration)
    const caches = installCaches()

    const applied = applyLatestVersion()
    await vi.waitFor(() =>
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }),
    )
    expect(reload).not.toHaveBeenCalled()

    waiting.changeState('activated')
    await applied

    expect(reload).toHaveBeenCalledOnce()
    expect(caches.keys).not.toHaveBeenCalled()
    expect(caches.delete).not.toHaveBeenCalled()
    expect(container.getRegistrations).not.toHaveBeenCalled()
    expect(registration.unregister).not.toHaveBeenCalled()
  })

  it('accepts `controllerchange` as the activation signal', async () => {
    const waiting = new FakeWorker()
    const registration = fakeRegistration(waiting)
    const container = installServiceWorker(registration)
    const caches = installCaches()

    const applied = applyLatestVersion()
    await vi.waitFor(() => expect(waiting.postMessage).toHaveBeenCalledOnce())

    container.dispatchEvent(new Event('controllerchange'))
    await applied

    expect(reload).toHaveBeenCalledOnce()
    expect(caches.keys).not.toHaveBeenCalled()
    expect(registration.unregister).not.toHaveBeenCalled()
  })

  it('clears the caches and unregisters when no worker is waiting', async () => {
    const registration = fakeRegistration(null)
    const container = installServiceWorker(registration)
    const caches = installCaches(['precache-v1', 'assets'])

    await applyLatestVersion()

    expect(container.getRegistration).toHaveBeenCalledOnce()
    expect(caches.delete).toHaveBeenCalledWith('precache-v1')
    expect(caches.delete).toHaveBeenCalledWith('assets')
    expect(registration.unregister).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('falls back to clearing and unregistering when activation never arrives', async () => {
    vi.useFakeTimers()
    const waiting = new FakeWorker()
    const registration = fakeRegistration(waiting)
    installServiceWorker(registration)
    const caches = installCaches()

    const applied = applyLatestVersion()
    await vi.advanceTimersByTimeAsync(0)
    expect(waiting.postMessage).toHaveBeenCalledOnce()

    // A state that is not `activated` leaves the wait running.
    waiting.changeState('installing')
    await vi.advanceTimersByTimeAsync(500)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_500)
    await applied

    expect(caches.delete).toHaveBeenCalledTimes(2)
    expect(registration.unregister).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('falls back when looking the registration up throws', async () => {
    const container = installServiceWorker(null)
    container.getRegistration.mockRejectedValue(new Error('no registration'))
    container.getRegistrations.mockResolvedValue([])
    const caches = installCaches([])

    await applyLatestVersion()

    expect(caches.keys).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads even when wiping the caches throws', async () => {
    installServiceWorker(fakeRegistration(null))
    const caches = installCaches()
    caches.keys.mockRejectedValue(new Error('storage unavailable'))

    await applyLatestVersion()

    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads without touching either API when neither is available', async () => {
    await applyLatestVersion()

    expect(reload).toHaveBeenCalledOnce()
  })
})
