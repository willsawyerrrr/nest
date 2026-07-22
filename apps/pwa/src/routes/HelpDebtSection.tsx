import { HelpDebtScreen } from '../components/HelpDebtScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useMembers } from '../hooks/useMembers'

export function HelpDebtSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const helpDebts = useHelpDebts(householdId)

  if (membersLoading || helpDebts.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <HelpDebtScreen
      members={members}
      helpDebts={helpDebts.helpDebts ?? []}
      onSave={helpDebts.upsert}
    />
  )
}
