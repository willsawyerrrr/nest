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
import { useMemberAllowances } from '../hooks/useMemberAllowances'
import { useMembers } from '../hooks/useMembers'
import { useSavers } from '../hooks/useSavers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { toAssignableAllowances } from '../lib/allowances'
import { derivedAmountContext } from '../lib/breakdowns'
import { cashFlowLines, inflowSources } from '../lib/cashFlow'
import { summariseHousehold } from '../lib/summary'

export function SummarySection() {
  const { active: planning } = usePlanningMode()
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows()
  const taxProfiles = useTaxProfiles()
  const budgetLines = useBudgetLines()
  const temporaryItems = useTemporaryItems()
  const memberAllowances = useMemberAllowances()
  const contributions = useSuperContributions()
  const gifts = useGifts()
  const breakdowns = useBreakdowns()
  const helpDebts = useHelpDebts()
  const deductions = useDeductions()
  const goals = useGoals()
  const savers = useSavers()

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    budgetLines.loading ||
    temporaryItems.loading ||
    memberAllowances.loading ||
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
      memberAllowances: memberAllowances.allowances ?? [],
      taxProfiles: taxProfiles.profiles ?? [],
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

  const lines = cashFlowLines(
    budgetLines.lines ?? [],
    temporaryItems.items ?? [],
    context,
    new Date(),
    toAssignableAllowances(memberAllowances.allowances ?? [], members),
  )

  const sources = inflowSources(inflows.inflows ?? [], new Date())

  return (
    <SummaryView
      summary={summary}
      lines={lines}
      sources={sources}
      {...(baseline && { baseline })}
    />
  )
}
