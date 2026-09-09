import { LoadingScreen } from '../components/LoadingScreen'
import { usePlanningMode } from '../components/PlanningModeProvider'
import { SummaryView } from '../components/SummaryView'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines, type BudgetLine } from '../hooks/useBudgetLines'
import { useDeductions } from '../hooks/useDeductions'
import { useGifts } from '../hooks/useGifts'
import { useGoals, type Goal } from '../hooks/useGoals'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows, type Inflow } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSavers } from '../hooks/useSavers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { derivedAmountContext } from '../lib/breakdowns'
import { summariseHousehold } from '../lib/summary'

export function SummarySection({ householdId }: { householdId: string }) {
  const { active: planning } = usePlanningMode()
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
  const goals = useGoals(householdId)
  const savers = useSavers()

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
    goals.loading ||
    savers.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const context = derivedAmountContext(
    breakdowns.breakdowns ?? [],
    breakdowns.items ?? [],
    gifts.budgets ?? [],
    gifts.recipients ?? [],
    gifts.discretionaryBudget,
  )

  // The reconciliation from one set of the two sandboxed row lists. Planning
  // mode swaps in the real rows to compute the baseline the same way, so the two
  // agree by construction rather than a second implementation.
  const buildSummary = (inflowRows: Inflow[], budgetLineRows: BudgetLine[], goalRows: Goal[]) =>
    summariseHousehold({
      inflows: inflowRows,
      budgetLines: budgetLineRows,
      taxProfiles: taxProfiles.profiles ?? [],
      financialYear: taxProfiles.financialYear,
      contributions: contributions.contributions ?? [],
      helpDebts: helpDebts.helpDebts ?? [],
      deductions: deductions.deductions ?? [],
      members,
      goals: goalRows,
      accounts: savers.savers ?? [],
      derivedAmounts: context,
      temporaryItems: temporaryItems.items ?? [],
    })

  const summary = buildSummary(inflows.inflows ?? [], budgetLines.lines ?? [], goals.goals ?? [])
  const baseline = planning
    ? buildSummary(
        inflows.baselineInflows ?? [],
        budgetLines.baselineLines ?? [],
        goals.baselineGoals ?? [],
      )
    : undefined

  return <SummaryView summary={summary} {...(baseline && { baseline })} />
}
