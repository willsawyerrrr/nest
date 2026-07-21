import { useChangelog } from '../hooks/useChangelog'
import { ChangelogScreen } from '../components/ChangelogScreen'
import { LoadingScreen } from '../components/LoadingScreen'

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
