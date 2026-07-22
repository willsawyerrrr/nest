import { registerSW } from 'virtual:pwa-register'

const UPDATE_INTERVAL_MS = 60_000

// Captured from `registerSW` so `applyLatestVersion` can activate a waiting
// service worker (skipWaiting + reload) rather than only polling for one.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return

    // iOS installed PWAs discover a new service worker only on a full fresh
    // load, which resuming from background never triggers — so a deploy can sit
    // unseen through many open/close cycles. Poll periodically and re-check
    // whenever the app returns to the foreground so `autoUpdate` fetches and
    // applies the new version shortly after the user opens the app.
    setInterval(() => registration.update(), UPDATE_INTERVAL_MS)

    const checkForUpdate = () => registration.update()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    window.addEventListener('focus', checkForUpdate)
  },
})

/**
 * Forces the running PWA to the newest deployed build. First asks
 * vite-plugin-pwa to activate a waiting service worker (`skipWaiting`) and
 * reload to it — the graceful path when a new worker is already detected. Then,
 * as a fallback for iOS where a stale precache can persist even with no worker
 * reported as waiting, best-effort clears the Cache Storage and unregisters
 * every service worker before a guaranteed hard `location.reload()`, so the next
 * load fetches the current bundle from the network. Guarded so it is a no-op
 * where the service worker / Cache Storage APIs are unavailable.
 */
export async function applyLatestVersion(): Promise<void> {
  try {
    // Graceful update: activates a waiting worker and reloads to it. When none
    // is waiting this resolves without reloading, so the hard path below runs.
    await updateSW(true)
  } catch {
    // Ignore — the hard fallback below still guarantees the latest version.
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
