import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Center, Loader } from '@mantine/core'
import type { Session } from '@supabase/supabase-js'
import { summarise } from '@nest/plan'
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
import { usePaySplits } from './hooks/usePaySplits'
import { useSuperContributions } from './hooks/useSuperContributions'
import { useGifts } from './hooks/useGifts'
import { useBreakdowns } from './hooks/useBreakdowns'
import { useBreakdownItems } from './hooks/useBreakdownItems'
import type { Breakdown } from './hooks/useBreakdowns'
import { useUpConnection } from './hooks/useUpConnection'
import { useRefreshSavers } from './hooks/useRefreshSavers'
import { useReconcileBreakdownLines } from './hooks/useReconcileBreakdownLines'
import { useDerivedLineEditor } from './hooks/useDerivedLineEditor'
import { useSaveSuperProfile } from './hooks/useSaveSuperProfile'
import { useChangelog } from './hooks/useChangelog'
import { HomeScreen } from './components/HomeScreen'
import { InflowScreen } from './components/InflowScreen'
import { BudgetScreen } from './components/BudgetScreen'
import { SplitsScreen } from './components/SplitsScreen'
import { GoalScreen } from './components/GoalScreen'
import { TaxEstimateView } from './components/TaxEstimateView'
import { SummaryView } from './components/SummaryView'
import { SuperScreen } from './components/SuperScreen'
import { GiftsScreen } from './components/GiftsScreen'
import { BreakdownsScreen } from './components/BreakdownsScreen'
import { BreakdownDetail } from './components/BreakdownDetail'
import { NetWorthView } from './components/NetWorthView'
import { ChangelogScreen } from './components/ChangelogScreen'
import { NAV_ITEMS, TabBar } from './components/TabBar'
import {
  currentTaxConfig,
  estimateHouseholdTaxFromRows,
  netAnnualSuperContributionFromRows,
  superCapSummaryFromRows,
} from './lib/tax'
import { accountsWithEffectiveSuperBalances, superAccountIds } from './lib/super'
import { giftBudgetTotalCents } from './lib/gifts'
import { applyBreakdownAmounts } from './lib/derivedBudget'
import { breakdownAnnualTotals, breakdownItemCounts } from './lib/breakdowns'
import { toSummaryInput } from './lib/summary'
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
          <Route path="/splits" element={<SplitsSection householdId={household.id} />} />
          <Route path="/goals" element={<GoalsSection householdId={household.id} />} />
          <Route path="/tax" element={<TaxSection householdId={household.id} />} />
          <Route path="/super" element={<SuperSection householdId={household.id} />} />
          <Route path="/breakdowns" element={<BreakdownsSection householdId={household.id} />} />
          <Route
            path="/breakdowns/:id"
            element={<BreakdownDetailSection householdId={household.id} />}
          />
          <Route path="/whats-new" element={<ChangelogSection />} />
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
  const breakdowns = useBreakdowns(householdId)
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)

  const giftBudgets = useMemo(() => gifts.budgets ?? [], [gifts.budgets])
  const breakdownRows = useMemo(() => breakdowns.breakdowns ?? [], [breakdowns.breakdowns])
  const breakdownItems = useMemo(() => breakdowns.items ?? [], [breakdowns.items])
  const totals = useMemo(
    () => breakdownAnnualTotals(breakdownRows, breakdownItems, giftBudgetTotalCents(giftBudgets)),
    [breakdownRows, breakdownItems, giftBudgets],
  )
  const counts = useMemo(
    () => breakdownItemCounts(breakdownRows, breakdownItems, giftBudgets.length),
    [breakdownRows, breakdownItems, giftBudgets.length],
  )

  useReconcileBreakdownLines({
    lines: budgetLines.lines,
    dataLoaded: !budgetLines.loading && !breakdowns.loading && !gifts.loading,
    breakdowns: breakdownRows,
    totals,
    counts,
    createLine: budgetLines.create,
    updateLine: budgetLines.update,
    removeLine: budgetLines.remove,
  })

  const handleUpdateDerivedLine = useDerivedLineEditor({
    lines: budgetLines.lines,
    updateBreakdown: breakdowns.update,
    updateLine: budgetLines.update,
  })

  if (
    budgetLines.loading ||
    temporaryItems.loading ||
    goals.loading ||
    gifts.loading ||
    breakdowns.loading ||
    accounts.loading ||
    superProfiles.loading
  ) {
    return <LoadingScreen />
  }

  // Super-fund balance accounts are not spendable, so they cannot fund a line.
  const superIds = superAccountIds(superProfiles.profiles ?? [])
  return (
    <BudgetScreen
      lines={applyBreakdownAmounts(budgetLines.lines ?? [], totals)}
      goals={(goals.goals ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        linkedAccountId: g.linked_account_id,
      }))}
      accounts={(accounts.accounts ?? [])
        .filter((account) => !superIds.has(account.id))
        .map((account) => ({ id: account.id, name: account.name }))}
      breakdowns={breakdownRows.map((breakdown) => ({
        id: breakdown.id,
        name: breakdown.name,
        line_group: breakdown.line_group,
      }))}
      temporaryItems={temporaryItems.items ?? []}
      onCreateLine={budgetLines.create}
      onUpdateLine={budgetLines.update}
      onUpdateDerivedLine={handleUpdateDerivedLine}
      onDeleteLine={budgetLines.remove}
      onCreateItem={temporaryItems.create}
      onUpdateItem={temporaryItems.update}
      onDeleteItem={temporaryItems.remove}
    />
  )
}

function SplitsSection({ householdId }: { householdId: string }) {
  const budgetLines = useBudgetLines(householdId)
  const goals = useGoals(householdId)
  const accounts = useAccounts(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const paySplits = usePaySplits(householdId)

  if (
    budgetLines.loading ||
    goals.loading ||
    accounts.loading ||
    superProfiles.loading ||
    paySplits.loading
  ) {
    return <LoadingScreen />
  }

  // Super-fund balance accounts are not spendable, so they are never split targets.
  const superIds = superAccountIds(superProfiles.profiles ?? [])
  return (
    <SplitsScreen
      accounts={(accounts.accounts ?? []).filter((account) => !superIds.has(account.id))}
      lines={budgetLines.lines ?? []}
      goals={goals.goals ?? []}
      configuredByAccount={paySplits.configuredByAccount}
      onConfirm={(id, cents) => void paySplits.confirm(id, cents)}
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

  const profileRows = superProfiles.profiles

  const onSave = useSaveSuperProfile({
    profiles: profileRows,
    insertAccount: accounts.insert,
    updateAccount: accounts.update,
    upsertProfile: superProfiles.upsert,
  })

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

function GiftsSection({
  householdId,
  backTo,
  backLabel,
}: {
  householdId: string
  backTo: string
  backLabel: string
}) {
  const gifts = useGifts(householdId)

  if (gifts.loading) {
    return <LoadingScreen />
  }

  return (
    <GiftsScreen
      backTo={backTo}
      backLabel={backLabel}
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

function BreakdownsSection({ householdId }: { householdId: string }) {
  const breakdowns = useBreakdowns(householdId)
  const gifts = useGifts(householdId)

  if (breakdowns.loading || gifts.loading) {
    return <LoadingScreen />
  }

  const totals = breakdownAnnualTotals(
    breakdowns.breakdowns ?? [],
    breakdowns.items ?? [],
    giftBudgetTotalCents(gifts.budgets ?? []),
  )

  return (
    <BreakdownsScreen
      breakdowns={breakdowns.breakdowns ?? []}
      totalsByBreakdownId={totals}
      onCreate={breakdowns.create}
    />
  )
}

function BreakdownDetailSection({ householdId }: { householdId: string }) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const breakdowns = useBreakdowns(householdId)

  // A breakdown opened from a budget line returns to the budget; otherwise it
  // falls back to the Breakdowns tab (the default on a direct visit or refresh,
  // where no origin is recorded in the navigation state).
  const backTo = (location.state as { from?: string } | null)?.from ?? '/breakdowns'
  const backLabel = backTo === '/budget' ? 'Budget' : 'Breakdowns'

  if (breakdowns.loading) {
    return <LoadingScreen />
  }

  const breakdown = (breakdowns.breakdowns ?? []).find((candidate) => candidate.id === id)
  if (!breakdown) {
    return <Navigate to="/breakdowns" replace />
  }

  // A gift breakdown is edited through the existing gift planner; a generic one
  // through its item editor.
  if (breakdown.kind === 'gift') {
    return <GiftsSection householdId={householdId} backTo={backTo} backLabel={backLabel} />
  }

  return (
    <GenericBreakdownSection
      householdId={householdId}
      breakdown={breakdown}
      backTo={backTo}
      backLabel={backLabel}
      onUpdate={breakdowns.update}
      onDelete={breakdowns.remove}
    />
  )
}

function GenericBreakdownSection({
  householdId,
  breakdown,
  backTo,
  backLabel,
  onUpdate,
  onDelete,
}: {
  householdId: string
  breakdown: Breakdown
  backTo: string
  backLabel: string
  onUpdate: (
    id: string,
    input: { name: string; line_group: Breakdown['line_group'] },
  ) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const navigate = useNavigate()
  const items = useBreakdownItems(householdId, breakdown.id)

  if (items.loading) {
    return <LoadingScreen />
  }

  return (
    <BreakdownDetail
      breakdown={breakdown}
      backTo={backTo}
      backLabel={backLabel}
      items={items.items ?? []}
      onUpdateBreakdown={(input) => onUpdate(breakdown.id, input)}
      onDeleteBreakdown={async () => {
        await onDelete(breakdown.id)
        navigate('/breakdowns')
      }}
      onCreateItem={items.create}
      onUpdateItem={items.update}
      onDeleteItem={items.remove}
    />
  )
}

function ChangelogSection() {
  const { implemented, inProgress, configured, loading, error } = useChangelog()

  if (loading) {
    return <LoadingScreen />
  }

  return (
    <ChangelogScreen
      implemented={implemented}
      inProgress={inProgress}
      configured={configured}
      error={error}
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
