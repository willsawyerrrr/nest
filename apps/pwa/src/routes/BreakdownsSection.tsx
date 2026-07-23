import { BreakdownsScreen } from '../components/BreakdownsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useGifts } from '../hooks/useGifts'
import { breakdownTotalsByBreakdownId, derivedAmountContext } from '../lib/breakdowns'

export function BreakdownsSection({ householdId }: { householdId: string }) {
  const breakdowns = useBreakdowns(householdId)
  const gifts = useGifts(householdId)

  if (breakdowns.loading || gifts.loading) {
    return <LoadingScreen />
  }

  const context = derivedAmountContext(
    breakdowns.breakdowns ?? [],
    breakdowns.items ?? [],
    gifts.budgets ?? [],
    gifts.recipients ?? [],
  )
  const totals = breakdownTotalsByBreakdownId(breakdowns.breakdowns ?? [], context)

  return (
    <BreakdownsScreen
      breakdowns={breakdowns.breakdowns ?? []}
      totalsByBreakdownId={totals}
      onCreate={breakdowns.create}
    />
  )
}
