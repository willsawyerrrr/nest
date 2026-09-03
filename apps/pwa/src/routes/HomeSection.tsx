import type { Session } from '@supabase/supabase-js'
import { HomeScreen } from '../components/HomeScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { type Household } from '../hooks/useHousehold'
import { useMembers } from '../hooks/useMembers'
import {
  NOTIFICATION_TRIGGERS,
  useNotificationPreferences,
} from '../hooks/useNotificationPreferences'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useUpConnection } from '../hooks/useUpConnection'
import { supabase } from '../lib/supabase'

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
  const { members, loading: membersLoading, reload: reloadMembers, setDateOfBirth } = useMembers()
  const taxProfiles = useTaxProfiles(household.id)
  const up = useUpConnection(reloadMembers)
  // A push subscription is tagged to the signed-in member, so it waits on the
  // members load; null until then, which only blocks subscribing.
  const currentMemberId = members?.find((member) => member.user_id === session.user.id)?.id ?? null
  const push = usePushNotifications(household.id, currentMemberId)
  const notificationPreferences = useNotificationPreferences(household.id, currentMemberId)

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
      onUpsertTaxProfile={async ({ profile, dateOfBirth }) => {
        await taxProfiles.upsert(profile)
        await setDateOfBirth(profile.member_id, dateOfBirth)
      }}
      onCreateInviteCode={onCreateInviteCode}
      onRevokeInviteCode={onRevokeInviteCode}
      onConnectUp={up.connect}
      onDisconnectUp={up.disconnect}
      upBusy={up.busy}
      push={push}
      notificationPreferences={NOTIFICATION_TRIGGERS.map((trigger) => ({
        trigger,
        enabled: notificationPreferences.enabled(trigger),
      }))}
      onToggleNotificationPreference={(trigger, next) =>
        void notificationPreferences.setEnabled(trigger, next)
      }
      onSignOut={() => void supabase.auth.signOut()}
    />
  )
}
