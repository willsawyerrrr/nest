import { BreakdownsScreen } from '../components/BreakdownsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { breakdownTotalsByBreakdownId, derivedAmountContext } from '../lib/breakdowns'

export function BreakdownsSection({ householdId }: { householdId: string }) {
  const breakdowns = useBreakdowns(householdId)

  if (breakdowns.loading) {
    return <LoadingScreen />
  }

  // Breakdowns are generic-only. Transitional guard: gifts roll up standalone
  // (keyed by `budget_line.is_gift_line`) and never mint a breakdown, so no
  // `kind = 'gift'` row is created; this filter only shields the brief prod window
  // before the contract migration deletes any pre-existing gift breakdown.
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
