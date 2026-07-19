import { useEffect, useState } from 'react'
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
import { useUpConnection } from './hooks/useUpConnection'
import { HomeScreen } from './components/HomeScreen'
import { InflowScreen } from './components/InflowScreen'
import { BudgetScreen } from './components/BudgetScreen'
import { GoalScreen } from './components/GoalScreen'
import { TaxEstimateView } from './components/TaxEstimateView'
import { SummaryView } from './components/SummaryView'
import { NAV_ITEMS, TabBar } from './components/TabBar'
import { estimateHouseholdTaxFromRows } from './lib/tax'
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
          <Route path="/inflows" element={<InflowsSection householdId={household.id} />} />
          <Route path="/budget" element={<BudgetSection householdId={household.id} />} />
          <Route path="/goals" element={<GoalsSection householdId={household.id} />} />
          <Route path="/tax" element={<TaxSection householdId={household.id} />} />
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

  if (budgetLines.loading || temporaryItems.loading || goals.loading) {
    return <LoadingScreen />
  }

  return (
    <BudgetScreen
      lines={budgetLines.lines ?? []}
      goals={goals.goals ?? []}
      temporaryItems={temporaryItems.items ?? []}
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

  if (goals.loading || budgetLines.loading) {
    return <LoadingScreen />
  }

  return (
    <GoalScreen
      goals={goals.goals ?? []}
      lines={budgetLines.lines ?? []}
      onCreateGoal={goals.create}
      onUpdateGoal={goals.update}
      onDeleteGoal={goals.remove}
    />
  )
}

function TaxSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)

  if (membersLoading || inflows.loading || taxProfiles.loading || !members) {
    return <LoadingScreen />
  }

  const estimate = estimateHouseholdTaxFromRows(inflows.inflows ?? [], taxProfiles.profiles ?? [])
  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'

  return (
    <TaxEstimateView
      estimate={estimate}
      financialYear={taxProfiles.financialYear}
      memberName={memberName}
    />
  )
}

function SummarySection({ householdId }: { householdId: string }) {
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const budgetLines = useBudgetLines(householdId)
  const temporaryItems = useTemporaryItems(householdId)

  if (inflows.loading || taxProfiles.loading || budgetLines.loading || temporaryItems.loading) {
    return <LoadingScreen />
  }

  const estimate = estimateHouseholdTaxFromRows(inflows.inflows ?? [], taxProfiles.profiles ?? [])
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
      budgetLines: (budgetLines.lines ?? []).map((line) => ({
        group: line.line_group,
        amountCents: line.amount_cents,
        frequency: line.frequency,
      })),
      temporaryItems: (temporaryItems.items ?? []).map((item) => ({
        contributionCents: item.contribution_cents,
        targetDate: item.target_date,
      })),
    },
    new Date(),
  )

  return <SummaryView summary={summary} />
}
