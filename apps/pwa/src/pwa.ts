import { registerSW } from 'virtual:pwa-register'

const UPDATE_INTERVAL_MS = 60_000

registerSW({
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
