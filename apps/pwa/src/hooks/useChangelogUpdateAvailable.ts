import { useSyncExternalStore } from 'react'

type Listener = () => void

let updateAvailable = false
const listeners = new Set<Listener>()

/**
 * Records whether the changelog last reported a build newer than the one
 * running. `useChangelog` calls this once it has loaded, so every other
 * consumer can badge an entry point without fetching the changelog itself.
 */
export function setChangelogUpdateAvailable(value: boolean) {
  if (updateAvailable === value) {
    return
  }
  updateAvailable = value
  listeners.forEach((listener) => listener())
}

/** Test-only: clears the flag so each test starts from a known state. */
export function resetChangelogUpdateAvailable() {
  setChangelogUpdateAvailable(false)
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return updateAvailable
}

/**
 * Whether the changelog has reported an update available. Reads `false`
 * until the changelog has been fetched at least once this session — this
 * hook never fetches on its own, so a page that only shows a badge never
 * pays for a changelog load nobody asked to see.
 */
export function useChangelogUpdateAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
