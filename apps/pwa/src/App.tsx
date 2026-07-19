import { useEffect, useState } from 'react'
import { Center, Loader, Text, UnstyledButton } from '@mantine/core'
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
import { HomeScreen } from './components/HomeScreen'
import { InflowScreen } from './components/InflowScreen'
import { BudgetScreen } from './components/BudgetScreen'
import { GoalScreen } from './components/GoalScreen'
import { TaxEstimateView } from './components/TaxEstimateView'
import { SummaryView } from './components/SummaryView'
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
  const { households, loading, reload } = useHousehold()

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

  return <HouseholdApp household={household} session={session} />
}

type View = 'summary' | 'inflows' | 'budget' | 'goals' | 'tax' | 'home'

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: 'summary', label: 'Summary' },
  { view: 'inflows', label: 'Inflows' },
  { view: 'budget', label: 'Budget' },
  { view: 'goals', label: 'Goals' },
  { view: 'tax', label: 'Tax' },
  { view: 'home', label: 'Household' },
]

function HouseholdApp({ household, session }: { household: Household; session: Session }) {
  const [view, setView] = useState<View>('summary')

  return (
    <div className="app-shell">
      <main className="page">
        {view === 'home' ? (
          <HomeScreen
            householdName={household.name}
            inviteCode={household.invite_code}
            email={session.user.email ?? ''}
            onSignOut={() => void supabase.auth.signOut()}
          />
        ) : view === 'inflows' ? (
          <InflowsSection householdId={household.id} />
        ) : view === 'budget' ? (
          <BudgetSection householdId={household.id} />
        ) : view === 'goals' ? (
          <GoalsSection householdId={household.id} />
        ) : view === 'summary' ? (
          <SummarySection householdId={household.id} />
        ) : (
          <TaxSection householdId={household.id} />
        )}
      </main>
      <nav className="tab-bar" aria-label="Primary">
        <div className="tab-bar__list">
          {NAV_ITEMS.map((item) => {
            const active = view === item.view
            return (
              <UnstyledButton
                key={item.view}
                className="tab-bar__tab"
                aria-current={active}
                onClick={() => setView(item.view)}
                py="sm"
                ta="center"
              >
                <Text
                  size="sm"
                  fw={active ? 700 : 500}
                  c={active ? 'var(--mantine-primary-color-filled)' : 'dimmed'}
                >
                  {item.label}
                </Text>
              </UnstyledButton>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

function InflowsSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const taxProfiles = useTaxProfiles(householdId)

  if (membersLoading || inflows.loading || taxProfiles.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <InflowScreen
      members={members}
      inflows={inflows.inflows ?? []}
      taxProfiles={taxProfiles.profiles ?? []}
      financialYear={taxProfiles.financialYear}
      onCreateInflow={inflows.create}
      onUpdateInflow={inflows.update}
      onDeleteInflow={inflows.remove}
      onUpsertTaxProfile={taxProfiles.upsert}
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
        .map((inflow) => ({ amountCents: inflow.amount_cents ?? 0, frequency: inflow.schedule })),
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
