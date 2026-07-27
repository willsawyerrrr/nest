import { useCallback, useState } from 'react'
import { ChangelogScreen } from '../components/ChangelogScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useChangelog } from '../hooks/useChangelog'
import { applyLatestVersion } from '../pwa'

export function ChangelogSection() {
  const { available, implemented, inProgress, configured, loading, error } = useChangelog()
  const [updating, setUpdating] = useState(false)

  // Each update ends in its own page reload, so a second one restarts an
  // in-flight navigation and throws away what it had already fetched — hence the
  // guard. A successful update never clears `updating`: the reload replaces the
  // page. A failure clears it, so the button offers the update again rather than
  // sitting in "Updating…" with no way out.
  const update = useCallback(async () => {
    if (updating) {
      return
    }
    setUpdating(true)
    try {
      await applyLatestVersion()
    } catch {
      setUpdating(false)
    }
  }, [updating])

  if (loading) {
    return <LoadingScreen />
  }

  return (
    <ChangelogScreen
      available={available}
      implemented={implemented}
      inProgress={inProgress}
      configured={configured}
      error={error}
      onUpdate={() => void update()}
      updating={updating}
    />
  )
}
