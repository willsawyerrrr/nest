import { LoadingScreen } from '../components/LoadingScreen'
import { TradesScreen } from '../components/TradesScreen'
import { useMembers } from '../hooks/useMembers'
import { useTrades } from '../hooks/useTrades'

export function InvestmentsSection() {
  const { members, loading: membersLoading } = useMembers()
  const trades = useTrades()

  if (membersLoading || trades.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <TradesScreen
      members={members}
      trades={trades.trades ?? []}
      onCreate={trades.create}
      onUpdate={trades.update}
      onDelete={trades.remove}
    />
  )
}
