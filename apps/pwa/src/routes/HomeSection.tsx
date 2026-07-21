import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { type Household } from '../hooks/useHousehold'
import { useMembers } from '../hooks/useMembers'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useUpConnection } from '../hooks/useUpConnection'
import { HomeScreen } from '../components/HomeScreen'
import { LoadingScreen } from '../components/LoadingScreen'

export function HomeSection({
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
