import { BreakdownsScreen } from '../components/BreakdownsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useGifts } from '../hooks/useGifts'
import { breakdownAnnualTotals } from '../lib/breakdowns'
import { giftBudgetTotalCents } from '../lib/gifts'

export function BreakdownsSection({ householdId }: { householdId: string }) {
  const breakdowns = useBreakdowns(householdId)
  const gifts = useGifts(householdId)

  if (breakdowns.loading || gifts.loading) {
    return <LoadingScreen />
  }

  const totals = breakdownAnnualTotals(
    breakdowns.breakdowns ?? [],
    breakdowns.items ?? [],
    giftBudgetTotalCents(gifts.budgets ?? []),
  )

  return (
    <BreakdownsScreen
      breakdowns={breakdowns.breakdowns ?? []}
      totalsByBreakdownId={totals}
      onCreate={breakdowns.create}
    />
  )
}
