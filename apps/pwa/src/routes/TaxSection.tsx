import { LoadingScreen } from '../components/LoadingScreen'
import { usePlanningMode } from '../components/PlanningModeProvider'
import { TaxEstimateView } from '../components/TaxEstimateView'
import { useDeductions } from '../hooks/useDeductions'
import { useGoals } from '../hooks/useGoals'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { usePayslips } from '../hooks/usePayslips'
import { useSavers } from '../hooks/useSavers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { memberName } from '../lib/members'
import { paygWithheldFromRows } from '../lib/payslips'
import {
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  projectedInterestIncomeInputs,
  superCapSummaryFromRows,
} from '../lib/tax'

export function TaxSection({ householdId }: { householdId: string }) {
  const { active: planning } = usePlanningMode()
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const helpDebts = useHelpDebts(householdId)
  const deductions = useDeductions(householdId)
  const payslips = usePayslips(householdId)
  const goals = useGoals(householdId)
  const savers = useSavers()

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    superProfiles.loading ||
    helpDebts.loading ||
    deductions.loading ||
    payslips.loading ||
    goals.loading ||
    savers.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const config = currentTaxConfig()
  const saverRows = savers.savers ?? []
  // A goal modelling an interest rate adds projected savings interest to the
  // estimate as assessable `other` income, attributed by its linked saver's
  // ownership (else split across the household).
  const interestIncomes = projectedInterestIncomeInputs(goals.goals ?? [], saverRows, members)
  const projectedInterestCentsByMember = new Map<string, number>()
  for (const income of interestIncomes) {
    projectedInterestCentsByMember.set(
      income.memberId,
      (projectedInterestCentsByMember.get(income.memberId) ?? 0) + (income.amountCents ?? 0),
    )
  }
  // Actual withholding from this year's payslips nets against each member's
  // estimated liability, turning it into a refund or an amount owing. With no
  // payslips the map is empty and every figure is the bare estimate.
  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
    helpDebts.helpDebts ?? [],
    deductions.deductions ?? [],
    config,
    paygWithheldFromRows(payslips.payslips ?? []),
    members,
    interestIncomes,
  )
  const capSummaries = superCapSummaryFromRows(
    inflows.inflows ?? [],
    superProfiles.profiles ?? [],
    contributions.contributions ?? [],
  )
  const concessionalCapCentsByMember = new Map(
    [...capSummaries].map(([memberId, summary]) => [memberId, summary.concessionalCapCents]),
  )
  const helpPayoff = helpPayoffByMember(estimate, helpDebts.helpDebts ?? [])

  // The same estimate from the real inflows, so each card can show what the
  // sandbox's inflow edits move. Everything else feeding the estimate is
  // unsandboxed, so only the inflow list is swapped.
  const baseline = planning
    ? estimateHouseholdTaxFromRows(
        inflows.baselineInflows ?? [],
        taxProfiles.profiles ?? [],
        contributions.contributions ?? [],
        helpDebts.helpDebts ?? [],
        deductions.deductions ?? [],
        config,
        paygWithheldFromRows(payslips.payslips ?? []),
        members,
        projectedInterestIncomeInputs(goals.baselineGoals ?? [], saverRows, members),
      )
    : undefined

  return (
    <TaxEstimateView
      estimate={estimate}
      {...(baseline && { baseline })}
      financialYear={taxProfiles.financialYear}
      memberName={(id) => memberName(members, id)}
      config={config}
      concessionalCapCentsByMember={concessionalCapCentsByMember}
      helpPayoff={helpPayoff}
      projectedInterestCentsByMember={projectedInterestCentsByMember}
    />
  )
}
