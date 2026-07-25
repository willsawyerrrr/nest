import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { LoadingScreen } from './components/LoadingScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { SignInScreen } from './components/SignInScreen'
import { NAV_ITEMS, TabBar } from './components/TabBar'
import { useHousehold, type Household } from './hooks/useHousehold'
import { supabase } from './lib/supabase'
import './App.css'

// Each route section is loaded on demand so its screen and dependencies form
// their own chunk, keeping the initial download to the auth/onboarding shell.
const BreakdownDetailSection = lazy(() =>
  import('./routes/BreakdownDetailSection').then((m) => ({ default: m.BreakdownDetailSection })),
)
const BreakdownsSection = lazy(() =>
  import('./routes/BreakdownsSection').then((m) => ({ default: m.BreakdownsSection })),
)
const BudgetSection = lazy(() =>
  import('./routes/BudgetSection').then((m) => ({ default: m.BudgetSection })),
)
const ChangelogSection = lazy(() =>
  import('./routes/ChangelogSection').then((m) => ({ default: m.ChangelogSection })),
)
const DeductionsSection = lazy(() =>
  import('./routes/DeductionsSection').then((m) => ({ default: m.DeductionsSection })),
)
const EquitySection = lazy(() =>
  import('./routes/EquitySection').then((m) => ({ default: m.EquitySection })),
)
const GiftsSection = lazy(() =>
  import('./routes/GiftsSection').then((m) => ({ default: m.GiftsSection })),
)
const GoalsSection = lazy(() =>
  import('./routes/GoalsSection').then((m) => ({ default: m.GoalsSection })),
)
const HelpDebtSection = lazy(() =>
  import('./routes/HelpDebtSection').then((m) => ({ default: m.HelpDebtSection })),
)
const HomeSection = lazy(() =>
  import('./routes/HomeSection').then((m) => ({ default: m.HomeSection })),
)
const InflowsSection = lazy(() =>
  import('./routes/InflowsSection').then((m) => ({ default: m.InflowsSection })),
)
const NetWorthSection = lazy(() =>
  import('./routes/NetWorthSection').then((m) => ({ default: m.NetWorthSection })),
)
const SplitsSection = lazy(() =>
  import('./routes/SplitsSection').then((m) => ({ default: m.SplitsSection })),
)
const SummarySection = lazy(() =>
  import('./routes/SummarySection').then((m) => ({ default: m.SummarySection })),
)
const SuperSection = lazy(() =>
  import('./routes/SuperSection').then((m) => ({ default: m.SuperSection })),
)
const TaxSection = lazy(() =>
  import('./routes/TaxSection').then((m) => ({ default: m.TaxSection })),
)

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
  const {
    households,
    loading,
    createHousehold,
    joinHousehold,
    createInviteCode,
    revokeInviteCode,
  } = useHousehold()

  if (loading) {
    return <LoadingScreen />
  }

  const household = households?.[0]

  if (!household) {
    return <OnboardingScreen onCreate={createHousehold} onJoin={joinHousehold} />
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
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/summary" element={<SummarySection householdId={household.id} />} />
            <Route path="/net-worth" element={<NetWorthSection householdId={household.id} />} />
            <Route path="/inflows" element={<InflowsSection householdId={household.id} />} />
            <Route path="/budget" element={<BudgetSection householdId={household.id} />} />
            <Route path="/splits" element={<SplitsSection householdId={household.id} />} />
            <Route path="/goals" element={<GoalsSection householdId={household.id} />} />
            <Route path="/tax" element={<TaxSection householdId={household.id} />} />
            <Route path="/deductions" element={<DeductionsSection householdId={household.id} />} />
            <Route path="/super" element={<SuperSection householdId={household.id} />} />
            <Route path="/help-debt" element={<HelpDebtSection householdId={household.id} />} />
            <Route path="/equity" element={<EquitySection householdId={household.id} />} />
            <Route path="/gifts" element={<GiftsSection householdId={household.id} />} />
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
        </Suspense>
      </main>
      <TabBar items={NAV_ITEMS} />
    </div>
  )
}
