import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BreakdownDetail } from '../components/BreakdownDetail'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBreakdownItems } from '../hooks/useBreakdownItems'
import { useBreakdowns, type Breakdown } from '../hooks/useBreakdowns'

export function BreakdownDetailSection({ householdId }: { householdId: string }) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const breakdowns = useBreakdowns(householdId)

  // A breakdown opened from a budget line returns to the budget; otherwise it
  // falls back to the Breakdowns tab (the default on a direct visit or refresh,
  // where no origin is recorded in the navigation state).
  const backTo = (location.state as { from?: string } | null)?.from ?? '/breakdowns'
  const backLabel = backTo === '/budget' ? 'Budget' : 'Breakdowns'

  if (breakdowns.loading) {
    return <LoadingScreen />
  }

  const breakdown = (breakdowns.breakdowns ?? []).find((candidate) => candidate.id === id)
  if (!breakdown) {
    return <Navigate to="/breakdowns" replace />
  }

  // Gifts are managed solely in the Gifts tab. Transitional guard: gifts roll up
  // standalone (keyed by `budget_line.is_gift_line`) with no breakdown, so this
  // redirect only shields the brief prod window before the contract migration
  // deletes any pre-existing gift breakdown a stale link might still target.
  if (breakdown.kind === 'gift') {
    return <Navigate to="/gifts" replace />
  }

  return (
    <GenericBreakdownSection
      householdId={householdId}
      breakdown={breakdown}
      backTo={backTo}
      backLabel={backLabel}
      onUpdate={breakdowns.update}
      onDelete={breakdowns.remove}
    />
  )
}

function GenericBreakdownSection({
  householdId,
  breakdown,
  backTo,
  backLabel,
  onUpdate,
  onDelete,
}: {
  householdId: string
  breakdown: Breakdown
  backTo: string
  backLabel: string
  onUpdate: (
    id: string,
    input: { name: string; line_group: Breakdown['line_group'] },
  ) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const navigate = useNavigate()
  const items = useBreakdownItems(householdId, breakdown.id)

  if (items.loading) {
    return <LoadingScreen />
  }

  return (
    <BreakdownDetail
      breakdown={breakdown}
      backTo={backTo}
      backLabel={backLabel}
      items={items.items ?? []}
      onUpdateBreakdown={(input) => onUpdate(breakdown.id, input)}
      onDeleteBreakdown={async () => {
        await onDelete(breakdown.id)
        navigate('/breakdowns')
      }}
      onCreateItem={items.create}
      onUpdateItem={items.update}
      onDeleteItem={items.remove}
    />
  )
}
