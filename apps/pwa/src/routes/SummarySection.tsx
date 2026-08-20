import { summarise } from '@nest/plan'
import { LoadingScreen } from '../components/LoadingScreen'
import { SummaryView } from '../components/SummaryView'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useDeductions } from '../hooks/useDeductions'
import { useGifts } from '../hooks/useGifts'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { derivedAmountContext } from '../lib/breakdowns'
import { toSummaryInput } from '../lib/summary'
import { estimateHouseholdTaxFromRows } from '../lib/tax'

export function SummarySection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const contributions = useSuperContributions(householdId)
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)
  const helpDebts = useHelpDebts(householdId)
  const deductions = useDeductions(householdId)

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    budgetLines.loading ||
    temporaryItems.loading ||
    contributions.loading ||
    gifts.loading ||
    breakdowns.loading ||
    helpDebts.loading ||
    deductions.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const context = derivedAmountContext(
    breakdowns.breakdowns ?? [],
    breakdowns.items ?? [],
    gifts.budgets ?? [],
    gifts.recipients ?? [],
  )

  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
    helpDebts.helpDebts ?? [],
    deductions.deductions ?? [],
    undefined,
    undefined,
    members,
  )
  // One-off money is reported beside the plan, never inside it, so the take-home the
  // ledger divides up is the year's after-tax cash NET of it — as are the tax and
  // salary-sacrifice slices the gross basis rebuilds Gross from, or Gross would
  // include money Available does not.
  const oneOffTaxCents = estimate.annualOneOffGrossCents - estimate.annualOneOffAfterTaxCents
  const summary = summarise(
    toSummaryInput({
      afterTaxIncomeAnnualCents: estimate.annualAfterTaxCents - estimate.annualOneOffAfterTaxCents,
      financialYear: taxProfiles.financialYear,
      inflows: inflows.inflows ?? [],
      budgetLines: budgetLines.lines ?? [],
      derivedAmounts: context,
      temporaryItems: temporaryItems.items ?? [],
      // The salary-sacrifice total is currently just the net concessional
      // super, and is the bucket other pre-tax sacrifices (e.g. a novated
      // lease) will add into.
      salarySacrificeAnnualCents: estimate.annualNetConcessionalSuperCents,
      // The pre-tax "Tax" slice is income tax and levies plus the 15% super
      // contributions tax (the gross concessional less what nets into the fund).
      taxAnnualCents:
        estimate.annualTaxCents -
        oneOffTaxCents +
        (estimate.annualConcessionalContributionsCents - estimate.annualNetConcessionalSuperCents),
    }),
    new Date(),
  )

  return <SummaryView summary={summary} />
}
