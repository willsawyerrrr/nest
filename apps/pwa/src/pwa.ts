import { registerSW } from 'virtual:pwa-register'

// The update helper lives beside this module, free of both the `virtual:` import
// (which only resolves through vite-plugin-pwa) and the registration side effects
// below, so it is directly testable. Re-exported here as the PWA entry point's
// public surface.
export { applyLatestVersion } from './serviceWorkerUpdate'

const UPDATE_INTERVAL_MS = 60_000

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return

    // iOS installed PWAs discover a new service worker only on a full fresh
    // load, which resuming from background never triggers — so a deploy can sit
    // unseen through many open/close cycles. Poll periodically and re-check
    // whenever the app returns to the foreground so a new version is fetched and
    // precached shortly after the user opens the app, ready for
    // `applyLatestVersion` to activate.
    setInterval(() => registration.update(), UPDATE_INTERVAL_MS)

    const checkForUpdate = () => registration.update()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    window.addEventListener('focus', checkForUpdate)
  },
})
