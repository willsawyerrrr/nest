import { useEffect, useRef } from 'react'
import { acknowledgeSharedFiles, subscribeSharedFiles, takeSharedFiles } from '../lib/nativeShare'

/**
 * Hands `onFiles` the files shared into the native app from other apps, those
 * already waiting and each one that arrives while `enabled`, then tells the
 * native side they are queued. Never fires in a browser, where nothing is
 * shared in.
 */
export function useSharedFiles(enabled: boolean, onFiles: (files: File[]) => void): void {
  const handler = useRef(onFiles)
  handler.current = onFiles

  useEffect(() => {
    if (!enabled) {
      return
    }
    const drain = () => {
      const taken = takeSharedFiles()
      if (taken.length === 0) {
        return
      }
      handler.current(taken.map(({ file }) => file))
      acknowledgeSharedFiles(taken.map(({ id }) => id))
    }
    drain()
    return subscribeSharedFiles(drain)
  }, [enabled])
}
