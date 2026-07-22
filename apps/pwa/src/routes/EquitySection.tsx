import { EquityScreen } from '../components/EquityScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useEquityGrants } from '../hooks/useEquityGrants'
import { useMembers } from '../hooks/useMembers'

export function EquitySection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const equityGrants = useEquityGrants(householdId)

  if (membersLoading || equityGrants.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <EquityScreen
      members={members}
      grants={equityGrants.grants ?? []}
      asOf={new Date()}
      onCreate={equityGrants.create}
      onUpdate={equityGrants.update}
      onDelete={equityGrants.remove}
    />
  )
}
