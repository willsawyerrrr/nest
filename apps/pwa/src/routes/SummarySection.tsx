import { summarise } from '@nest/plan'
import { useInflows } from '../hooks/useInflows'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useGifts } from '../hooks/useGifts'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { SummaryView } from '../components/SummaryView'
import { LoadingScreen } from '../components/LoadingScreen'
import { estimateHouseholdTaxFromRows } from '../lib/tax'
import { giftBudgetTotalCents } from '../lib/gifts'
import { breakdownAnnualTotals } from '../lib/breakdowns'
import { toSummaryInput } from '../lib/summary'

export function SummarySection({ householdId }: { householdId: string }) {
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const contributions = useSuperContributions(householdId)
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)

  if (
    inflows.loading ||
    taxProfiles.loading ||
    budgetLines.loading ||
    temporaryItems.loading ||
    contributions.loading ||
    gifts.loading ||
    breakdowns.loading
  ) {
    return <LoadingScreen />
  }

  const totals = breakdownAnnualTotals(
    breakdowns.breakdowns ?? [],
    breakdowns.items ?? [],
    giftBudgetTotalCents(gifts.budgets ?? []),
  )

  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
  )
  const summary = summarise(
    toSummaryInput({
      afterTaxIncomeAnnualCents: estimate.annualAfterTaxCents,
      inflows: inflows.inflows ?? [],
      budgetLines: budgetLines.lines ?? [],
      breakdownTotals: totals,
      temporaryItems: temporaryItems.items ?? [],
    }),
    new Date(),
  )

  return <SummaryView summary={summary} />
}
