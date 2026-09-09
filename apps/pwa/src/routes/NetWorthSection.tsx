import { useState } from 'react'
import { grantValueCents } from '@nest/plan'
import { LoadingScreen } from '../components/LoadingScreen'
import { NetWorthView } from '../components/NetWorthView'
import { usePlanningMode } from '../components/PlanningModeProvider'
import { useAccounts } from '../hooks/useAccounts'
import { useBudgetLines, type BudgetLine } from '../hooks/useBudgetLines'
import { useDeductions } from '../hooks/useDeductions'
import { useEquityGrants } from '../hooks/useEquityGrants'
import { useGoals, type Goal } from '../hooks/useGoals'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows, type Inflow } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { equityGrantToPlan } from '../lib/equity'
import { memberName } from '../lib/members'
import {
  computeNetWorth,
  projectionHorizonYears,
  resolveHorizonYears,
  type NetWorthComputeResult,
} from '../lib/netWorth'
import {
  readAssumptions,
  readMemberAges,
  readProjectionHorizon,
  writeProjectionHorizon,
  type ProjectionHorizonOption,
} from '../lib/retirement'
import { superAccountIds, type EquityHolding, type Liability } from '../lib/super'

export function NetWorthSection() {
  const { active: planning } = usePlanningMode()
  const accounts = useAccounts()
  const superProfiles = useSuperProfiles()
  const contributions = useSuperContributions()
  const inflows = useInflows()
  const helpDebts = useHelpDebts()
  const equityGrants = useEquityGrants()
  const taxProfiles = useTaxProfiles()
  const deductions = useDeductions()
  const goals = useGoals()
  const budgetLines = useBudgetLines()
  const { members, loading: membersLoading } = useMembers()
  const [horizon, setHorizon] = useState<ProjectionHorizonOption>(readProjectionHorizon)

  if (
    accounts.loading ||
    superProfiles.loading ||
    contributions.loading ||
    inflows.loading ||
    helpDebts.loading ||
    equityGrants.loading ||
    taxProfiles.loading ||
    deductions.loading ||
    goals.loading ||
    budgetLines.loading ||
    membersLoading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const profileRows = superProfiles.profiles ?? []
  const contributionRows = contributions.contributions ?? []
  const helpDebtRows = helpDebts.helpDebts ?? []
  const grantRows = equityGrants.grants ?? []

  const liabilities: Liability[] = helpDebtRows
    .filter((debt) => debt.balance_cents > 0)
    .map((debt) => ({
      label: `${memberName(members, debt.member_id)}'s HELP debt`,
      balanceCents: debt.balance_cents,
    }))

  const today = new Date()
  const planGrants = grantRows.map(equityGrantToPlan)
  const equity: EquityHolding[] = grantRows
    .map((grant) => ({
      label: `${memberName(members, grant.member_id)} — ${grant.label}`,
      valueCents: grantValueCents(equityGrantToPlan(grant), today),
    }))
    .filter((holding) => holding.valueCents > 0)

  const superIds = superAccountIds(profileRows)

  const changeHorizon = (option: ProjectionHorizonOption) => {
    setHorizon(option)
    writeProjectionHorizon(option)
  }

  const assumptions = readAssumptions()
  const ages = readMemberAges()
  const retirementHorizonYears = projectionHorizonYears(
    members.map((member) => ages[member.id]).filter((age): age is number => age !== undefined),
    assumptions.retirementAge,
  )
  const horizonYears = resolveHorizonYears(horizon, retirementHorizonYears)

  // The net worth and its projection from one set of the sandboxed row lists.
  // Planning mode swaps in the real rows and computes the baseline the same way,
  // so the two agree by construction.
  const outcomeFor = (
    inflowRows: Inflow[],
    goalRows: Goal[],
    lineRows: BudgetLine[],
  ): NetWorthComputeResult =>
    computeNetWorth({
      accounts: accounts.accounts ?? [],
      superProfiles: profileRows,
      contributions: contributionRows,
      taxProfiles: taxProfiles.profiles ?? [],
      helpDebts: helpDebtRows,
      deductions: deductions.deductions ?? [],
      members,
      planGrants,
      liabilities,
      equity,
      inflows: inflowRows,
      goals: goalRows,
      budgetLines: lineRows,
      assumptions,
      horizonYears,
      now: today,
    })

  const outcome = outcomeFor(inflows.inflows ?? [], goals.goals ?? [], budgetLines.lines ?? [])
  const baseline = planning
    ? outcomeFor(
        inflows.baselineInflows ?? [],
        goals.baselineGoals ?? [],
        budgetLines.baselineLines ?? [],
      )
    : undefined

  // The goals still linked to each account, so removing one Up has dropped can
  // warn which goals fall back to a manual balance.
  const linkedGoalNamesByAccount = new Map<string, string[]>()
  for (const goal of goals.goals ?? []) {
    if (goal.linked_account_id === null) {
      continue
    }
    const names = linkedGoalNamesByAccount.get(goal.linked_account_id) ?? []
    names.push(goal.name)
    linkedGoalNamesByAccount.set(goal.linked_account_id, names)
  }
  return (
    <NetWorthView
      accounts={outcome.effectiveAccounts}
      superIds={superIds}
      equity={equity}
      liabilities={liabilities}
      projection={outcome.projection}
      projectionBaseYear={today.getFullYear()}
      horizon={horizon}
      onHorizonChange={changeHorizon}
      {...(baseline && {
        baselineTotalCents: baseline.totalCents,
        baselineProjectionEndCents: baseline.projection.at(-1)?.totalCents ?? 0,
      })}
      linkedGoalNamesByAccount={linkedGoalNamesByAccount}
      onToggleExclude={(id, exclude) => {
        void accounts.update(id, { exclude_from_net_worth: exclude })
      }}
      onRemoveAccount={async (id) => {
        await accounts.remove(id)
        await goals.reload()
      }}
    />
  )
}
