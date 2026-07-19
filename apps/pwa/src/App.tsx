import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Center, Loader } from '@mantine/core'
import type { Session } from '@supabase/supabase-js'
import { summarise } from '@budget/plan'
import { supabase } from './lib/supabase'
import { useHousehold, type Household } from './hooks/useHousehold'
import { useMembers } from './hooks/useMembers'
import { useInflows } from './hooks/useInflows'
import { useTaxProfiles } from './hooks/useTaxProfiles'
import { SignInScreen } from './components/SignInScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { useBudgetLines } from './hooks/useBudgetLines'
import { useTemporaryItems } from './hooks/useTemporaryItems'
import { useGoals } from './hooks/useGoals'
import { useSavers } from './hooks/useSavers'
import { useAccounts } from './hooks/useAccounts'
import { useSuperProfiles } from './hooks/useSuperProfiles'
import { useSuperContributions } from './hooks/useSuperContributions'
import { useGifts } from './hooks/useGifts'
import type { Member } from './hooks/useMembers'
import { useUpConnection } from './hooks/useUpConnection'
import { useRefreshSavers } from './hooks/useRefreshSavers'
import { HomeScreen } from './components/HomeScreen'
import { InflowScreen } from './components/InflowScreen'
import { BudgetScreen } from './components/BudgetScreen'
import { GoalScreen } from './components/GoalScreen'
import { TaxEstimateView } from './components/TaxEstimateView'
import { SummaryView } from './components/SummaryView'
import { SuperScreen } from './components/SuperScreen'
import { GiftsScreen } from './components/GiftsScreen'
import { NetWorthView } from './components/NetWorthView'
import { NAV_ITEMS, TabBar } from './components/TabBar'
import {
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  netAnnualSuperContributionFromRows,
  superCapSummaryFromRows,
} from './lib/tax'
import { accountsWithEffectiveSuperBalances, superAccountIds, superAccountName } from './lib/super'
import { todayIso } from './lib/dates'
import { giftBudgetTotalCents } from './lib/gifts'
import { applyGiftDerivedAmounts } from './lib/derivedBudget'
import type { SuperFormValues } from './components/SuperProfileForm'
import './App.css'

function LoadingScreen() {
  return (
    <Center h="100dvh">
      <Loader />
    </Center>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    return (
      <SignInScreen
        onSignIn={() => {
          void supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin },
          })
        }}
      />
    )
  }

  return <AuthedApp session={session} />
}

function AuthedApp({ session }: { session: Session }) {
  const { households, loading, reload, createInviteCode, revokeInviteCode } = useHousehold()

  if (loading) {
    return <LoadingScreen />
  }

  const household = households?.[0]

  if (!household) {
    return (
      <OnboardingScreen
        onCreate={async (name, memberName) => {
          const { error } = await supabase.rpc('create_household', {
            p_name: name,
            p_member_name: memberName,
          })
          if (error) {
            throw error
          }
          await reload()
        }}
        onJoin={async (code, memberName) => {
          const { error } = await supabase.rpc('join_household', {
            p_code: code,
            p_member_name: memberName,
          })
          if (error) {
            throw error
          }
          await reload()
        }}
      />
    )
  }

  return (
    <HouseholdApp
      household={household}
      session={session}
      onCreateInviteCode={createInviteCode}
      onRevokeInviteCode={revokeInviteCode}
    />
  )
}

function HouseholdApp({
  household,
  session,
  onCreateInviteCode,
  onRevokeInviteCode,
}: {
  household: Household
  session: Session
  onCreateInviteCode: () => Promise<void>
  onRevokeInviteCode: () => Promise<void>
}) {
  return (
    <div className="app-shell">
      <main className="page">
        <Routes>
          <Route path="/summary" element={<SummarySection householdId={household.id} />} />
          <Route path="/net-worth" element={<NetWorthSection householdId={household.id} />} />
          <Route path="/inflows" element={<InflowsSection householdId={household.id} />} />
          <Route path="/budget" element={<BudgetSection householdId={household.id} />} />
          <Route path="/goals" element={<GoalsSection householdId={household.id} />} />
          <Route path="/tax" element={<TaxSection householdId={household.id} />} />
          <Route path="/super" element={<SuperSection householdId={household.id} />} />
          <Route path="/gifts" element={<GiftsSection householdId={household.id} />} />
          <Route
            path="/household"
            element={
              <HomeSection
                household={household}
                session={session}
                onCreateInviteCode={onCreateInviteCode}
                onRevokeInviteCode={onRevokeInviteCode}
              />
            }
          />
          <Route path="/" element={<Navigate to="/summary" replace />} />
          <Route path="*" element={<Navigate to="/summary" replace />} />
        </Routes>
      </main>
      <TabBar items={NAV_ITEMS} />
    </div>
  )
}

function HomeSection({
  household,
  session,
  onCreateInviteCode,
  onRevokeInviteCode,
}: {
  household: Household
  session: Session
  onCreateInviteCode: () => Promise<void>
  onRevokeInviteCode: () => Promise<void>
}) {
  const { members, loading: membersLoading, reload: reloadMembers } = useMembers()
  const taxProfiles = useTaxProfiles(household.id)
  const up = useUpConnection(reloadMembers)

  if (membersLoading || taxProfiles.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <HomeScreen
      householdName={household.name}
      inviteCode={household.invite_code}
      inviteCodeExpiresAt={household.invite_code_expires_at}
      email={session.user.email ?? ''}
      currentUserId={session.user.id}
      members={members}
      taxProfiles={taxProfiles.profiles ?? []}
      financialYear={taxProfiles.financialYear}
      onUpsertTaxProfile={taxProfiles.upsert}
      onCreateInviteCode={onCreateInviteCode}
      onRevokeInviteCode={onRevokeInviteCode}
      onConnectUp={up.connect}
      onDisconnectUp={up.disconnect}
      upBusy={up.busy}
      onSignOut={() => void supabase.auth.signOut()}
    />
  )
}

function InflowsSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)

  if (membersLoading || inflows.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <InflowScreen
      members={members}
      inflows={inflows.inflows ?? []}
      onCreateInflow={inflows.create}
      onUpdateInflow={inflows.update}
      onDeleteInflow={inflows.remove}
    />
  )
}

function BudgetSection({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const goals = useGoals(householdId)
  const gifts = useGifts(householdId)

  if (budgetLines.loading || temporaryItems.loading || goals.loading || gifts.loading) {
    return <LoadingScreen />
  }

  const giftBudgets = gifts.budgets ?? []
  return (
    <BudgetScreen
      lines={applyGiftDerivedAmounts(budgetLines.lines ?? [], giftBudgets)}
      goals={goals.goals ?? []}
      temporaryItems={temporaryItems.items ?? []}
      giftTotalCents={giftBudgetTotalCents(giftBudgets)}
      onCreateLine={budgetLines.create}
      onUpdateLine={budgetLines.update}
      onDeleteLine={budgetLines.remove}
      onCreateItem={temporaryItems.create}
      onUpdateItem={temporaryItems.update}
      onDeleteItem={temporaryItems.remove}
    />
  )
}

function GoalsSection({ householdId }: { householdId: string }) {
  const goals = useGoals(householdId)
  const budgetLines = useBudgetLines(householdId)
  const savers = useSavers()

  // Refreshing pulls fresh Up balances, so both the savers and the goals that
  // read from them are reloaded.
  const reloadSavers = savers.reload
  const reloadGoals = goals.reload
  const reloadBalances = useCallback(async () => {
    await Promise.all([reloadSavers(), reloadGoals()])
  }, [reloadSavers, reloadGoals])
  const refresh = useRefreshSavers(reloadBalances)

  if (goals.loading || budgetLines.loading || savers.loading) {
    return <LoadingScreen />
  }

  return (
    <GoalScreen
      goals={goals.goals ?? []}
      lines={budgetLines.lines ?? []}
      savers={savers.savers ?? []}
      onCreateGoal={goals.create}
      onUpdateGoal={goals.update}
      onDeleteGoal={goals.remove}
      onRefresh={() => void refresh.refresh()}
      refreshing={refresh.refreshing}
      refreshError={refresh.error}
    />
  )
}

function TaxSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const contributions = useSuperContributions(householdId)

  if (
    membersLoading ||
    inflows.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
  )
  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'

  return (
    <TaxEstimateView
      estimate={estimate}
      financialYear={taxProfiles.financialYear}
      memberName={memberName}
    />
  )
}

function SuperSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const superProfiles = useSuperProfiles(householdId)
  const accounts = useAccounts(householdId)
  const contributions = useSuperContributions(householdId)
  const inflows = useInflows(householdId)

  const upsertProfile = superProfiles.upsert
  const insertAccount = accounts.insert
  const updateAccount = accounts.update
  const profileRows = superProfiles.profiles

  // Persist a member's super: write the balance to their linked account (or
  // create a manual one and link it), then upsert the profile's fund name.
  const onSave = useCallback(
    async (member: Member, values: SuperFormValues) => {
      const profile = profileRows?.find((candidate) => candidate.member_id === member.id)
      const fundName = values.fundName === '' ? null : values.fundName
      const name = superAccountName(fundName, member.name)
      let accountId = profile?.linked_account_id ?? null
      if (accountId) {
        await updateAccount(accountId, { balance_cents: values.balanceCents, name })
      } else {
        accountId = await insertAccount({
          source: 'manual',
          type: 'savings',
          owner_member_id: member.id,
          name,
          balance_cents: values.balanceCents,
        })
      }
      await upsertProfile({
        member_id: member.id,
        fund_name: fundName,
        linked_account_id: accountId,
        // Saving re-confirms the actual balance, so this is a true-up as of today.
        balance_as_of: todayIso(),
      })
    },
    [profileRows, insertAccount, updateAccount, upsertProfile],
  )

  if (
    membersLoading ||
    superProfiles.loading ||
    accounts.loading ||
    contributions.loading ||
    inflows.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const capSummaries = superCapSummaryFromRows(
    inflows.inflows ?? [],
    profileRows ?? [],
    contributions.contributions ?? [],
  )
  const netContributionByMember = netAnnualSuperContributionFromRows(
    inflows.inflows ?? [],
    contributions.contributions ?? [],
  )

  return (
    <SuperScreen
      members={members}
      profiles={profileRows ?? []}
      accounts={accounts.accounts ?? []}
      contributions={contributions.contributions ?? []}
      capSummaries={capSummaries}
      netContributionByMember={netContributionByMember}
      preservationAge={currentTaxConfig().super.preservationAge}
      financialYear={superProfiles.financialYear}
      onSave={onSave}
      onCreateContribution={contributions.create}
      onUpdateContribution={contributions.update}
      onDeleteContribution={contributions.remove}
    />
  )
}

function GiftsSection({ householdId }: { householdId: string }) {
  const gifts = useGifts(householdId)

  if (gifts.loading) {
    return <LoadingScreen />
  }

  return (
    <GiftsScreen
      recipients={gifts.recipients ?? []}
      occasions={gifts.occasions ?? []}
      budgets={gifts.budgets ?? []}
      purchases={gifts.purchases ?? []}
      onCreateRecipient={gifts.createRecipient}
      onUpdateRecipient={gifts.updateRecipient}
      onDeleteRecipient={gifts.removeRecipient}
      onCreateOccasion={gifts.createOccasion}
      onUpdateOccasion={gifts.updateOccasion}
      onDeleteOccasion={gifts.removeOccasion}
      onCreateBudget={gifts.createBudget}
      onUpdateBudget={gifts.updateBudget}
      onDeleteBudget={gifts.removeBudget}
      onCreatePurchase={gifts.createPurchase}
      onUpdatePurchase={gifts.updatePurchase}
      onDeletePurchase={gifts.removePurchase}
    />
  )
}

function NetWorthSection({ householdId }: { householdId: string }) {
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const inflows = useInflows(householdId)

  if (accounts.loading || superProfiles.loading || contributions.loading || inflows.loading) {
    return <LoadingScreen />
  }

  const profileRows = superProfiles.profiles ?? []
  const netContributionByMember = netAnnualSuperContributionFromRows(
    inflows.inflows ?? [],
    contributions.contributions ?? [],
  )

  return (
    <NetWorthView
      accounts={accountsWithEffectiveSuperBalances(
        accounts.accounts ?? [],
        profileRows,
        netContributionByMember,
        new Date(),
      )}
      superIds={superAccountIds(profileRows)}
    />
  )
}

function SummarySection({ householdId }: { householdId: string }) {
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const contributions = useSuperContributions(householdId)
  const gifts = useGifts(householdId)

  if (
    inflows.loading ||
    taxProfiles.loading ||
    budgetLines.loading ||
    temporaryItems.loading ||
    contributions.loading ||
    gifts.loading
  ) {
    return <LoadingScreen />
  }

  const estimate = estimateHouseholdTaxFromRows(
    inflows.inflows ?? [],
    taxProfiles.profiles ?? [],
    contributions.contributions ?? [],
  )
  const summary = summarise(
    {
      afterTaxIncomeAnnualCents: estimate.annualAfterTaxCents,
      nonTaxableInflows: (inflows.inflows ?? [])
        .filter((inflow) => !inflow.taxable)
        .map((inflow) => ({
          amountCents: inflow.amount_cents ?? 0,
          frequency: inflow.schedule,
          intervalWeeks: inflow.interval_weeks ?? undefined,
        })),
      budgetLines: applyGiftDerivedAmounts(budgetLines.lines ?? [], gifts.budgets ?? []).map(
        (line) => ({
          group: line.line_group,
          amountCents: line.amount_cents,
          frequency: line.frequency,
        }),
      ),
      temporaryItems: (temporaryItems.items ?? []).map((item) => ({
        contributionCents: item.contribution_cents,
        targetDate: item.target_date,
      })),
    },
    new Date(),
  )

  return <SummaryView summary={summary} />
}
