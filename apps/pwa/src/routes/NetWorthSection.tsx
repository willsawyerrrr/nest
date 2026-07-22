import { grantValueCents } from '@nest/plan'
import { LoadingScreen } from '../components/LoadingScreen'
import { NetWorthView } from '../components/NetWorthView'
import { useAccounts } from '../hooks/useAccounts'
import { useEquityGrants } from '../hooks/useEquityGrants'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { equityGrantToPlan } from '../lib/equity'
import {
  accountsWithEffectiveSuperBalances,
  superAccountIds,
  type EquityHolding,
  type Liability,
} from '../lib/super'
import { netAnnualSuperContributionFromRows } from '../lib/tax'

export function NetWorthSection({ householdId }: { householdId: string }) {
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const inflows = useInflows(householdId)
  const helpDebts = useHelpDebts(householdId)
  const equityGrants = useEquityGrants(householdId)
  const { members, loading: membersLoading } = useMembers()

  if (
    accounts.loading ||
    superProfiles.loading ||
    contributions.loading ||
    inflows.loading ||
    helpDebts.loading ||
    equityGrants.loading ||
    membersLoading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const profileRows = superProfiles.profiles ?? []
  const netContributionByMember = netAnnualSuperContributionFromRows(
    inflows.inflows ?? [],
    contributions.contributions ?? [],
  )

  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'
  const liabilities: Liability[] = (helpDebts.helpDebts ?? [])
    .filter((debt) => debt.balance_cents > 0)
    .map((debt) => ({
      label: `${memberName(debt.member_id)} HELP debt`,
      balanceCents: debt.balance_cents,
    }))

  const today = new Date()
  const equity: EquityHolding[] = (equityGrants.grants ?? [])
    .map((grant) => ({
      label: `${memberName(grant.member_id)} — ${grant.label}`,
      valueCents: grantValueCents(equityGrantToPlan(grant), today),
    }))
    .filter((holding) => holding.valueCents > 0)

  return (
    <NetWorthView
      accounts={accountsWithEffectiveSuperBalances(
        accounts.accounts ?? [],
        profileRows,
        netContributionByMember,
        today,
      )}
      superIds={superAccountIds(profileRows)}
      equity={equity}
      liabilities={liabilities}
      onToggleExclude={(id, exclude) => {
        void accounts.update(id, { exclude_from_net_worth: exclude })
      }}
    />
  )
}
