import type { Session } from '@supabase/supabase-js'
import { HouseholdScreen } from '../components/HouseholdScreen'
import type { Household } from '../hooks/useHousehold'
import { signOut } from '../lib/nativeAuthBridge'

export function HouseholdSection({
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
    <HouseholdScreen
      householdName={household.name}
      email={session.user.email ?? ''}
      onSignOut={signOut}
      inviteCode={household.invite_code}
      inviteCodeExpiresAt={household.invite_code_expires_at}
      onCreateInviteCode={onCreateInviteCode}
      onRevokeInviteCode={onRevokeInviteCode}
    />
  )
}
