/**
 * How long {@link applyLatestVersion} waits for a waiting service worker to
 * report activation before giving up on the fast path. Activation is a local
 * install-then-swap with nothing left to download, so it lands well inside this
 * budget; the ceiling exists only so a worker that never activates — stuck,
 * redundant, or an event the browser withholds — falls through to the fallback
 * instead of hanging the button.
 */
const ACTIVATION_TIMEOUT_MS = 2_500

/**
 * Resolves `true` once `worker` reports activation, or `false` once
 * `ACTIVATION_TIMEOUT_MS` elapses without it.
 *
 * The durable signal is the worker's own `statechange` reaching `'activated'`:
 * installed iOS PWAs do not reliably fire `controllerchange`, so that event is
 * only a secondary trigger, for browsers that deliver it first.
 */
function waitForActivation(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (activated: boolean) => {
      clearTimeout(timer)
      worker.removeEventListener('statechange', onStateChange)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      resolve(activated)
    }
    const onStateChange = () => {
      if (worker.state === 'activated') settle(true)
    }
    const onControllerChange = () => settle(true)

    worker.addEventListener('statechange', onStateChange)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    timer = setTimeout(() => settle(false), ACTIVATION_TIMEOUT_MS)
  })
}

/**
 * Promotes an already-installed, waiting service worker to active, resolving
 * whether it got there.
 *
 * A waiting worker has finished precaching the new build, so telling it to skip
 * waiting — the `SKIP_WAITING` message the generated `sw.js` listens for — lets
 * the next load serve that new bundle straight from the precache. Resolves
 * `false` whenever activation cannot be established: no service worker support,
 * no waiting worker, activation not observed in time, or a thrown lookup.
 */
async function activateWaitingWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    const waiting = registration?.waiting
    if (!waiting) return false

    const activation = waitForActivation(waiting)
    waiting.postMessage({ type: 'SKIP_WAITING' })
    return await activation
  } catch {
    return false
  }
}

/**
 * Forces the running PWA to the newest deployed build.
 *
 * When a new service worker is already installed and waiting, it is activated
 * and the page reloaded onto its precache, skipping the re-download of a bundle
 * the device already holds.
 *
 * Every other case takes the fallback: best-effort clear the Cache Storage and
 * unregister every service worker, then hard-reload so the next load fetches the
 * current bundle from the network. Keep that fallback aggressive — iOS evicts
 * service workers and caches out from under installed PWAs, and WebKit has a
 * history of serving stale precached assets after a deploy, which wiping and
 * re-fetching is what defends against. It is the default path precisely because
 * it always lands on the new build; the fast path is the narrow exception where
 * landing there is guaranteed anyway.
 *
 * Guarded so it is a no-op where the service worker / Cache Storage APIs are
 * unavailable, and it always reloads.
 */
export async function applyLatestVersion(): Promise<void> {
  if (await activateWaitingWorker()) {
    location.reload()
    return
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }
  } catch {
    // Ignore — a hard reload still pulls the newest index and assets.
  }

  location.reload()
}
