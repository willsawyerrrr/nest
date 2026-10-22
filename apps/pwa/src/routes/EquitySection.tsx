import { EquityScreen } from '../components/EquityScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useEquityExercises } from '../hooks/useEquityExercises'
import { useEquityGrants } from '../hooks/useEquityGrants'
import { useEquitySales } from '../hooks/useEquitySales'
import { useMembers } from '../hooks/useMembers'
import { useNow } from '../hooks/useNow'

export function EquitySection() {
  const now = useNow()
  const { members, loading: membersLoading } = useMembers()
  const equityGrants = useEquityGrants()
  const equityExercises = useEquityExercises()
  const equitySales = useEquitySales()

  if (
    membersLoading ||
    equityGrants.loading ||
    equityExercises.loading ||
    equitySales.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  return (
    <EquityScreen
      members={members}
      grants={equityGrants.grants ?? []}
      exercises={equityExercises.exercises ?? []}
      sales={equitySales.sales ?? []}
      asOf={now}
      onCreate={equityGrants.create}
      onUpdate={equityGrants.update}
      onDelete={equityGrants.remove}
      onCreateExercise={equityExercises.create}
      onUpdateExercise={equityExercises.update}
      onDeleteExercise={equityExercises.remove}
      onCreateSale={equitySales.create}
      onUpdateSale={equitySales.update}
      onDeleteSale={equitySales.remove}
    />
  )
}
