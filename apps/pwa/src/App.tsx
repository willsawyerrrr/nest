import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  configsByYear,
  estimateHouseholdTax,
  financialYearForDate,
  FY2027_CONFIG,
  type IncomeInput,
  type Residency,
  type TaxProfileInput,
} from '@budget/tax'
import { supabase } from './lib/supabase'
import { useHousehold, type Household } from './hooks/useHousehold'
import { useMembers } from './hooks/useMembers'
import { useIncomes, type Income } from './hooks/useIncomes'
import { useTaxProfiles, type TaxProfile } from './hooks/useTaxProfiles'
import { SignInScreen } from './components/SignInScreen'
import { OnboardingScreen } from './components/OnboardingScreen'
import { HomeScreen } from './components/HomeScreen'
import { IncomeScreen } from './components/IncomeScreen'
import { TaxEstimateView } from './components/TaxEstimateView'
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
    return <p>Loading…</p>
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
    return <p>Loading…</p>
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

type View = 'home' | 'income' | 'tax'

function HouseholdApp({ household, session }: { household: Household; session: Session }) {
  const [view, setView] = useState<View>('home')

  return (
    <>
      <nav className="app-nav" aria-label="Primary">
        <button type="button" aria-current={view === 'home'} onClick={() => setView('home')}>
          Home
        </button>
        <button type="button" aria-current={view === 'income'} onClick={() => setView('income')}>
          Income
        </button>
        <button type="button" aria-current={view === 'tax'} onClick={() => setView('tax')}>
          Tax
        </button>
      </nav>
      {view === 'home' ? (
        <HomeScreen
          householdName={household.name}
          inviteCode={household.invite_code}
          email={session.user.email ?? ''}
          onSignOut={() => void supabase.auth.signOut()}
        />
      ) : view === 'income' ? (
        <IncomeSection householdId={household.id} />
      ) : (
        <TaxSection householdId={household.id} />
      )}
    </>
  )
}

function IncomeSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const incomes = useIncomes(householdId)
  const taxProfiles = useTaxProfiles(householdId)

  if (membersLoading || incomes.loading || taxProfiles.loading || !members) {
    return <p>Loading…</p>
  }

  return (
    <IncomeScreen
      members={members}
      incomes={incomes.incomes ?? []}
      taxProfiles={taxProfiles.profiles ?? []}
      financialYear={taxProfiles.financialYear}
      onCreateIncome={incomes.create}
      onUpdateIncome={incomes.update}
      onDeleteIncome={incomes.remove}
      onUpsertTaxProfile={taxProfiles.upsert}
    />
  )
}

/** Maps an `income` row to the tax engine's `IncomeInput`. */
function toIncomeInput(income: Income): IncomeInput {
  return {
    memberId: income.member_id,
    type: income.type,
    schedule: income.schedule,
    amountCents: income.amount_cents ?? undefined,
    hourlyRateCents: income.hourly_rate_cents ?? undefined,
    hoursPerPeriod: income.hours_per_period ?? undefined,
  }
}

/** Maps a `tax_profile` row to the tax engine's `TaxProfileInput`. */
function toTaxProfileInput(profile: TaxProfile): TaxProfileInput {
  const residency: Residency =
    profile.residency === 'foreign_resident' ? 'foreignResident' : 'resident'
  return {
    memberId: profile.member_id,
    residency,
    privateHospitalCover: profile.has_private_hospital_cover,
    helpDebtCents: profile.help_debt_cents,
  }
}

function TaxSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const incomes = useIncomes(householdId)
  const taxProfiles = useTaxProfiles(householdId)

  if (membersLoading || incomes.loading || taxProfiles.loading || !members) {
    return <p>Loading…</p>
  }

  const config = configsByYear[financialYearForDate(new Date())] ?? FY2027_CONFIG
  const estimate = estimateHouseholdTax(
    (incomes.incomes ?? []).map(toIncomeInput),
    (taxProfiles.profiles ?? []).map(toTaxProfileInput),
    config,
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
