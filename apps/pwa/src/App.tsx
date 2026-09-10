import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { HouseholdProvider } from './components/HouseholdProvider'
import { LoadingScreen } from './components/LoadingScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { PlanningModeBanner } from './components/PlanningModeBanner'
import { PlanningModeProvider, usePlanningMode } from './components/PlanningModeProvider'
import { SignInScreen } from './components/SignInScreen'
import { navSections, TabBar } from './components/TabBar'
import { useHousehold, type Household } from './hooks/useHousehold'
import { isNativeShell } from './lib/nativeShell'
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
const ConnectionsSection = lazy(() =>
  import('./routes/ConnectionsSection').then((m) => ({ default: m.ConnectionsSection })),
)
const DeductionsSection = lazy(() =>
  import('./routes/DeductionsSection').then((m) => ({ default: m.DeductionsSection })),
)
const EofySection = lazy(() =>
  import('./routes/EofySection').then((m) => ({ default: m.EofySection })),
)
// Never imports `supabase.auth` — the public share view carries no session at
// all, only its own bearer token, resolved by `useEofyShareData`.
const EofyShareSection = lazy(() =>
  import('./routes/EofyShareSection').then((m) => ({ default: m.EofyShareSection })),
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
const HouseholdSection = lazy(() =>
  import('./routes/HouseholdSection').then((m) => ({ default: m.HouseholdSection })),
)
const InflowsSection = lazy(() =>
  import('./routes/InflowsSection').then((m) => ({ default: m.InflowsSection })),
)
const MembersSection = lazy(() =>
  import('./routes/MembersSection').then((m) => ({ default: m.MembersSection })),
)
const NetWorthSection = lazy(() =>
  import('./routes/NetWorthSection').then((m) => ({ default: m.NetWorthSection })),
)
const NotificationsSection = lazy(() =>
  import('./routes/NotificationsSection').then((m) => ({ default: m.NotificationsSection })),
)
const PayslipsSection = lazy(() =>
  import('./routes/PayslipsSection').then((m) => ({ default: m.PayslipsSection })),
)
const PlanningSection = lazy(() =>
  import('./routes/PlanningSection').then((m) => ({ default: m.PlanningSection })),
)
const PlanningModeSection = lazy(() =>
  import('./routes/PlanningModeSection').then((m) => ({ default: m.PlanningModeSection })),
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
const WishlistSection = lazy(() =>
  import('./routes/WishlistSection').then((m) => ({ default: m.WishlistSection })),
)

/**
 * The public `/share/eofy/:token` route is matched before the session gate
 * below, so a tax agent opening a shared link never touches
 * `supabase.auth.getSession()` or waits on it — every other path falls
 * through to {@link AuthGate}, unchanged.
 */
export default function App() {
  return (
    <Routes>
      <Route
        path="/share/eofy/:token"
        element={
          <Suspense fallback={<LoadingScreen />}>
            <EofyShareSection />
          </Suspense>
        }
      />
      <Route path="*" element={<AuthGate />} />
    </Routes>
  )
}

/** The signed-in session gate: sign-in, onboarding, or the authenticated app. */
function AuthGate() {
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
    // In the native iOS shell the native app owns sign-in and injects the
    // session asynchronously; wait on it rather than ever showing the web
    // sign-in screen. A browser falls straight through to it, unchanged.
    if (isNativeShell()) {
      return <LoadingScreen />
    }

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
    <HouseholdProvider householdId={household.id}>
      <PlanningModeProvider>
        <HouseholdShell
          household={household}
          session={session}
          onCreateInviteCode={onCreateInviteCode}
          onRevokeInviteCode={onRevokeInviteCode}
        />
      </PlanningModeProvider>
    </HouseholdProvider>
  )
}

function HouseholdShell({
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
  const { active: planningActive } = usePlanningMode()
  return (
    <div className="app-shell">
      <main className="page">
        <PlanningModeBanner />
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/summary" element={<SummarySection />} />
            <Route path="/planning" element={<PlanningSection />} />
            <Route path="/net-worth" element={<NetWorthSection />} />
            <Route path="/inflows" element={<InflowsSection />} />
            <Route path="/budget" element={<BudgetSection />} />
            <Route path="/splits" element={<SplitsSection />} />
            <Route path="/goals" element={<GoalsSection />} />
            <Route path="/wishlist" element={<WishlistSection />} />
            <Route path="/tax" element={<TaxSection />} />
            <Route path="/payslips" element={<PayslipsSection />} />
            <Route path="/deductions" element={<DeductionsSection />} />
            <Route path="/super" element={<SuperSection />} />
            <Route path="/help-debt" element={<HelpDebtSection />} />
            <Route path="/eofy" element={<EofySection />} />
            <Route path="/equity" element={<EquitySection />} />
            <Route path="/gifts" element={<GiftsSection />} />
            <Route path="/breakdowns" element={<BreakdownsSection />} />
            <Route path="/breakdowns/:id" element={<BreakdownDetailSection />} />
            <Route path="/whats-new" element={<ChangelogSection />} />
            <Route
              path="/settings/account"
              element={
                <HouseholdSection
                  household={household}
                  session={session}
                  onCreateInviteCode={onCreateInviteCode}
                  onRevokeInviteCode={onRevokeInviteCode}
                />
              }
            />
            <Route path="/settings/members" element={<MembersSection />} />
            <Route path="/settings/partner" element={<Navigate to="/settings/account" replace />} />
            <Route
              path="/settings/connections"
              element={<ConnectionsSection session={session} />}
            />
            <Route
              path="/settings/notifications"
              element={<NotificationsSection session={session} />}
            />
            <Route path="/settings/planning-mode" element={<PlanningModeSection />} />
            <Route path="/household" element={<Navigate to="/settings/account" replace />} />
            <Route path="/" element={<Navigate to="/summary" replace />} />
            <Route path="*" element={<Navigate to="/summary" replace />} />
          </Routes>
        </Suspense>
      </main>
      <TabBar sections={navSections(planningActive)} />
    </div>
  )
}
