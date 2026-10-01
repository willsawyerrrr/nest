import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useChangelog } from './useChangelog'

const STORAGE_KEY = 'whats-new-seen-sha'

type Listener = () => void

// `undefined` means not yet read; `null` means no release has been recorded.
let seen: string | null | undefined
const listeners = new Set<Listener>()

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeSeen(sha: string) {
  seen = sha
  try {
    localStorage.setItem(STORAGE_KEY, sha)
  } catch {
    // Storage is unavailable: the in-memory value still holds for this session.
  }
  listeners.forEach((listener) => listener())
}

/** Test-only: forgets the in-memory value so the next read hits storage. */
export function resetReleaseSeen() {
  seen = undefined
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  seen ??= readStored()
  return seen
}

export interface UseReleaseSeenResult {
  /** Whether the newest release is one this device has not yet opened. */
  unseen: boolean
  /** Records the newest release as seen. */
  markSeen: () => void
}

/**
 * Tracks the newest release the member has seen, per device in `localStorage`
 * (with an in-memory fallback when storage is unavailable). A release is
 * identified by the commit SHA of the newest changelog entry, `available` ahead
 * of `implemented`. The first load on a device records the newest release as
 * seen, so releases that predate the member raise no chip. A changelog that is
 * loading, failed, or empty has no newest release, so nothing is unseen.
 */
export function useReleaseSeen(): UseReleaseSeenResult {
  const { available, implemented } = useChangelog()
  const latest = available[0]?.sha ?? implemented[0]?.sha ?? null
  const stored = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    if (latest !== null && stored === null) {
      writeSeen(latest)
    }
  }, [latest, stored])

  const markSeen = useCallback(() => {
    if (latest !== null) {
      writeSeen(latest)
    }
  }, [latest])

  return { unseen: latest !== null && stored !== null && stored !== latest, markSeen }
}
