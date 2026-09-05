import type { Session } from '@supabase/supabase-js'
import { AccountScreen } from '../components/AccountScreen'
import type { Household } from '../hooks/useHousehold'
import { supabase } from '../lib/supabase'

export function AccountSection({ household, session }: { household: Household; session: Session }) {
  return (
    <AccountScreen
      householdName={household.name}
      email={session.user.email ?? ''}
      onSignOut={() => void supabase.auth.signOut()}
    />
  )
}
