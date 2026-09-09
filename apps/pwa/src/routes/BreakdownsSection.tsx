import { BreakdownsScreen } from '../components/BreakdownsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { breakdownTotalsByBreakdownId, derivedAmountContext } from '../lib/breakdowns'

export function BreakdownsSection() {
  const breakdowns = useBreakdowns()

  if (breakdowns.loading) {
    return <LoadingScreen />
  }

  const breakdownRows = breakdowns.breakdowns ?? []
  const context = derivedAmountContext(breakdownRows, breakdowns.items ?? [], [], [], null)
  const totals = breakdownTotalsByBreakdownId(breakdownRows, context)

  return (
    <BreakdownsScreen
      breakdowns={breakdownRows}
      totalsByBreakdownId={totals}
      onCreate={breakdowns.create}
    />
  )
}
