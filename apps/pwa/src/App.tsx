import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { BreakdownLineReconciler } from './components/BreakdownLineReconciler'
import { LoadingScreen } from './components/LoadingScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { SignInScreen } from './components/SignInScreen'
import { NAV_ITEMS, TabBar } from './components/TabBar'
import { useHousehold, type Household } from './hooks/useHousehold'
import { supabase } from './lib/supabase'
import { BreakdownDetailSection } from './routes/BreakdownDetailSection'
import { BreakdownsSection } from './routes/BreakdownsSection'
import { BudgetSection } from './routes/BudgetSection'
import { ChangelogSection } from './routes/ChangelogSection'
import { EquitySection } from './routes/EquitySection'
import { GoalsSection } from './routes/GoalsSection'
import { HelpDebtSection } from './routes/HelpDebtSection'
import { HomeSection } from './routes/HomeSection'
import { InflowsSection } from './routes/InflowsSection'
import { NetWorthSection } from './routes/NetWorthSection'
import { SplitsSection } from './routes/SplitsSection'
import { SummarySection } from './routes/SummarySection'
import { SuperSection } from './routes/SuperSection'
import { TaxSection } from './routes/TaxSection'
import './App.css'

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
      <BreakdownLineReconciler householdId={household.id} />
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
          <Route path="/help-debt" element={<HelpDebtSection householdId={household.id} />} />
          <Route path="/equity" element={<EquitySection householdId={household.id} />} />
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
