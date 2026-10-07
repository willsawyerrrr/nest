import { useEffect, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { pendingSharedFileCount, subscribeSharedFiles } from '../lib/nativeShare'

/** Where shared receipts are reviewed. */
export const SHARED_FILES_PATH = '/deductions'

/**
 * Takes the member to their deductions screen when a file is shared into the
 * native app, so its receipt queue can pick it up. Renders nothing.
 */
export function SharedFilesRedirect() {
  const waiting = useSyncExternalStore(subscribeSharedFiles, pendingSharedFileCount)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (waiting > 0 && pathname !== SHARED_FILES_PATH) {
      navigate(SHARED_FILES_PATH)
    }
  }, [waiting, pathname, navigate])

  return null
}
