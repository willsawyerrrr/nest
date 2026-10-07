import { isNativeShell } from './nativeShell'

/** A file shared into the native app, with the id the native side tracks it by. */
export interface SharedFile {
  id: string
  file: File
}

interface Incoming {
  name: string
  type: string
  chunks: Uint8Array[]
}

const incoming = new Map<string, Incoming>()
const seen = new Set<string>()
const listeners = new Set<() => void>()
let pending: SharedFile[] = []

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/**
 * Wires the hooks the native shell calls to hand over a file shared into the
 * app from another app (Mail, Files, Photos, Safari). A file arrives as
 * `begin`, any number of base64 `chunk`s, then `finish`, and waits in memory
 * until a screen takes it with {@link takeSharedFiles}. A file whose id has
 * already arrived is ignored, so a repeated hand-off adds nothing. Outside the
 * shell this is a no-op, and safe to call more than once.
 */
export function installNativeShareBridge(): void {
  if (!isNativeShell()) {
    return
  }

  window.__nestShare = {
    begin: (id, name, type) => {
      if (!seen.has(id)) {
        incoming.set(id, { name, type, chunks: [] })
      }
    },
    chunk: (id, base64) => {
      incoming.get(id)?.chunks.push(decode(base64))
    },
    finish: (id) => {
      const entry = incoming.get(id)
      if (!entry) {
        return
      }
      incoming.delete(id)
      seen.add(id)
      pending.push({
        id,
        file: new File(entry.chunks as BlobPart[], entry.name, { type: entry.type }),
      })
      notify()
    },
  }
}

/** How many shared files are waiting for a screen to take them. */
export function pendingSharedFileCount(): number {
  return pending.length
}

/** Calls `listener` whenever a shared file arrives; returns how to stop. */
export function subscribeSharedFiles(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Takes every waiting shared file, leaving none behind. */
export function takeSharedFiles(): SharedFile[] {
  const taken = pending
  if (taken.length > 0) {
    pending = []
    notify()
  }
  return taken
}

/**
 * Tells the native side these files are queued, so it deletes its copies. Until
 * it hears, it keeps them and offers them again on the next launch.
 */
export function acknowledgeSharedFiles(ids: string[]): void {
  window.webkit?.messageHandlers.nestShare.postMessage({ type: 'queued', ids })
}

/** Forgets every file and listener; for tests. */
export function resetNativeShare(): void {
  incoming.clear()
  seen.clear()
  listeners.clear()
  pending = []
}
