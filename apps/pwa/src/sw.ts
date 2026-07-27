/// <reference lib="webworker" />
/*
 * The app's service worker. Written by hand rather than generated because a
 * `push` handler cannot be expressed through workbox's generated worker; the
 * precache manifest is injected into `self.__WB_MANIFEST` at build time.
 *
 * Everything below the push handlers reproduces what the generated worker did,
 * and the app depends on each piece: the precache and its route serve the
 * installed build, `SKIP_WAITING` is the message `applyLatestVersion` posts to
 * promote a waiting worker (the fast "Reload to update" path), stale precaches
 * are pruned on activation, and every navigation falls back to `index.html` so
 * the SPA's client routes resolve offline. There is deliberately no top-level
 * `skipWaiting()` or `clientsClaim()`: a new worker must *wait*, which is the
 * precondition that fast update path relies on.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { notificationUrl, parsePushPayload } from './lib/push'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (PrecacheEntry | string)[]
}

/** The PWA icons a notification renders with, from the precached app icons. */
const NOTIFICATION_ICON = '/pwa-192.png'
const NOTIFICATION_BADGE = '/pwa-192.png'

self.addEventListener('message', (event) => {
  const data: unknown = event.data
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'SKIP_WAITING'
  ) {
    self.skipWaiting()
  }
})

self.addEventListener('push', (event) => {
  const { title, body, url } = parsePushPayload(event.data?.text())
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openTarget(notificationUrl(event.notification.data)))
})

/**
 * Brings `url` to the front: an already-open window is focused and navigated
 * there, so a tap reuses the running app rather than stacking another copy;
 * with nothing open, a new window opens on it.
 */
async function openTarget(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows[0]
  if (existing) {
    await existing.focus()
    await existing.navigate(url)
    return
  }
  await self.clients.openWindow(url)
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
