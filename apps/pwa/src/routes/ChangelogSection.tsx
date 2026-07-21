import { ChangelogScreen } from '../components/ChangelogScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useChangelog } from '../hooks/useChangelog'

export function ChangelogSection() {
  const { implemented, inProgress, configured, loading, error } = useChangelog()

  if (loading) {
    return <LoadingScreen />
  }

  return (
    <ChangelogScreen
      implemented={implemented}
      inProgress={inProgress}
      configured={configured}
      error={error}
    />
  )
}
