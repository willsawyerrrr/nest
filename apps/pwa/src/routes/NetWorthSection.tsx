import { useState } from 'react'
import { grantValueCents, projectNetWorth } from '@nest/plan'
import { LoadingScreen } from '../components/LoadingScreen'
import { NetWorthView } from '../components/NetWorthView'
import { useAccounts } from '../hooks/useAccounts'
import { useBudgetLines } from '../hooks/useBudgetLines'
import { useDeductions } from '../hooks/useDeductions'
import { useEquityGrants } from '../hooks/useEquityGrants'
import { useGoals } from '../hooks/useGoals'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { equityGrantToPlan } from '../lib/equity'
import {
  combinedHelpCentsByYear,
  netWorthGoals,
  projectionHorizonYears,
  resolveHorizonYears,
  splitCashAndDebt,
} from '../lib/netWorth'
import {
  readAssumptions,
  readMemberAges,
  readProjectionHorizon,
  writeProjectionHorizon,
  type ProjectionHorizonOption,
} from '../lib/retirement'
import {
  accountsWithEffectiveSuperBalances,
  netWorthBreakdown,
  superAccountIds,
  type EquityHolding,
  type Liability,
} from '../lib/super'
import {
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  netAnnualSuperContributionFromRows,
} from '../lib/tax'

export function NetWorthSection({ householdId }: { householdId: string }) {
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const inflows = useInflows(householdId)
  const helpDebts = useHelpDebts(householdId)
  const equityGrants = useEquityGrants(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const deductions = useDeductions(householdId)
  const goals = useGoals(householdId)
  const budgetLines = useBudgetLines(householdId)
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
  const inflowRows = inflows.inflows ?? []
  const contributionRows = contributions.contributions ?? []
  const helpDebtRows = helpDebts.helpDebts ?? []
  const grantRows = equityGrants.grants ?? []
  const netContributionByMember = netAnnualSuperContributionFromRows(inflowRows, contributionRows)

  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'
  const liabilities: Liability[] = helpDebtRows
    .filter((debt) => debt.balance_cents > 0)
    .map((debt) => ({
      label: `${memberName(debt.member_id)}'s HELP debt`,
      balanceCents: debt.balance_cents,
    }))

  const today = new Date()
  const planGrants = grantRows.map(equityGrantToPlan)
  const equity: EquityHolding[] = grantRows
    .map((grant) => ({
      label: `${memberName(grant.member_id)} — ${grant.label}`,
      valueCents: grantValueCents(equityGrantToPlan(grant), today),
    }))
    .filter((holding) => holding.valueCents > 0)

  const effectiveAccounts = accountsWithEffectiveSuperBalances(
    accounts.accounts ?? [],
    profileRows,
    netContributionByMember,
    today,
  )
  const superIds = superAccountIds(profileRows)
  const breakdown = netWorthBreakdown(effectiveAccounts, superIds)

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
  const estimate = estimateHouseholdTaxFromRows(
    inflowRows,
    taxProfiles.profiles ?? [],
    contributionRows,
    helpDebtRows,
    deductions.deductions ?? [],
  )
  const helpNowCents = helpDebtRows.reduce(
    (total, debt) => total + Math.max(0, debt.balance_cents),
    0,
  )
  const helpCentsByYear = combinedHelpCentsByYear(
    helpPayoffByMember(estimate, helpDebtRows).values(),
    helpNowCents,
    horizonYears,
  )
  const totalNetContributionCents = [...netContributionByMember.values()].reduce(
    (total, cents) => total + cents,
    0,
  )
  // A linked goal's saver balance is already in the account totals, so goals fold
  // in only their future contributions on top, resolved from that same balance.
  const balanceByAccountId = new Map(
    effectiveAccounts.map((account) => [account.id, account.balance_cents]),
  )
  const savingsGoals = netWorthGoals(goals.goals ?? [], budgetLines.lines ?? [], balanceByAccountId)
  // Split the other accounts so a negative-balance account (credit card, loan)
  // becomes its own debt band rather than sinking the cash asset band.
  const { cashCents, debtCents } = splitCashAndDebt(breakdown.otherAccounts)
  const projection = projectNetWorth({
    asOf: today,
    horizonYears,
    superInput: {
      currentBalanceCents: breakdown.superTotalCents,
      annualContributionCents: totalNetContributionCents,
      nominalReturnRate: assumptions.expectedReturnPct / 100,
      contributionGrowthRate: assumptions.contributionGrowthPct / 100,
    },
    otherCents: cashCents,
    equityGrants: planGrants,
    helpCentsByYear,
    savingsGoals,
    debtCents,
  })

  return (
    <NetWorthView
      accounts={effectiveAccounts}
      superIds={superIds}
      equity={equity}
      liabilities={liabilities}
      projection={projection}
      projectionBaseYear={today.getFullYear()}
      horizon={horizon}
      onHorizonChange={changeHorizon}
      onToggleExclude={(id, exclude) => {
        void accounts.update(id, { exclude_from_net_worth: exclude })
      }}
    />
  )
}
