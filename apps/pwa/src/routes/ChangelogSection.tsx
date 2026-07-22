import { ChangelogScreen } from '../components/ChangelogScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useChangelog } from '../hooks/useChangelog'
import { applyLatestVersion } from '../pwa'

export function ChangelogSection() {
  const { available, implemented, inProgress, configured, loading, error } = useChangelog()

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
      onUpdate={() => void applyLatestVersion()}
    />
  )
}
