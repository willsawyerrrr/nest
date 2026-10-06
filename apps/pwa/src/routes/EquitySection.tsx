import { EquityScreen } from '../components/EquityScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useEquityGrants } from '../hooks/useEquityGrants'
import { useMembers } from '../hooks/useMembers'
import { useNow } from '../hooks/useNow'

export function EquitySection() {
  const now = useNow()
  const { members, loading: membersLoading } = useMembers()
  const equityGrants = useEquityGrants()

  if (membersLoading || equityGrants.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <EquityScreen
      members={members}
      grants={equityGrants.grants ?? []}
      asOf={now}
      onCreate={equityGrants.create}
      onUpdate={equityGrants.update}
      onDelete={equityGrants.remove}
    />
  )
}
