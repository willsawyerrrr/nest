import { useMembers } from '../hooks/useMembers'
import { useInflows } from '../hooks/useInflows'
import { InflowScreen } from '../components/InflowScreen'
import { LoadingScreen } from '../components/LoadingScreen'

export function InflowsSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)

  if (membersLoading || inflows.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <InflowScreen
      members={members}
      inflows={inflows.inflows ?? []}
      onCreateInflow={inflows.create}
      onUpdateInflow={inflows.update}
      onDeleteInflow={inflows.remove}
    />
  )
}
