import { BreakdownsScreen } from '../components/BreakdownsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { breakdownTotalsByBreakdownId, derivedAmountContext } from '../lib/breakdowns'

export function BreakdownsSection({ householdId }: { householdId: string }) {
  const breakdowns = useBreakdowns(householdId)

  if (breakdowns.loading) {
    return <LoadingScreen />
  }

  // Gifts are managed solely in the Gifts tab; the gift breakdown is an internal
  // roll-up mechanism, so it never appears as a row here.
  const genericBreakdowns = (breakdowns.breakdowns ?? []).filter(
    (breakdown) => breakdown.kind !== 'gift',
  )
  const context = derivedAmountContext(genericBreakdowns, breakdowns.items ?? [], [], [])
  const totals = breakdownTotalsByBreakdownId(genericBreakdowns, context)

  return (
    <BreakdownsScreen
      breakdowns={genericBreakdowns}
      totalsByBreakdownId={totals}
      onCreate={breakdowns.create}
    />
  )
}
