import { summarise } from '@nest/plan'
import { LoadingScreen } from '../components/LoadingScreen'
import { SummaryView } from '../components/SummaryView'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useGifts } from '../hooks/useGifts'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { breakdownAnnualTotals } from '../lib/breakdowns'
import { giftBudgetTotalCents } from '../lib/gifts'
import { toSummaryInput } from '../lib/summary'
import { estimateHouseholdTaxFromRows } from '../lib/tax'

export function SummarySection({ householdId }: { householdId: string }) {
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const contributions = useSuperContributions(householdId)
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)
  const helpDebts = useHelpDebts(householdId)

  if (
    inflows.loading ||
    taxProfiles.loading ||
    budgetLines.loading ||
    temporaryItems.loading ||
    contributions.loading ||
    gifts.loading ||
    breakdowns.loading ||
    helpDebts.loading
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
    helpDebts.helpDebts ?? [],
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
