import type { Session } from '@supabase/supabase-js'
import { HomeScreen } from '../components/HomeScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useCalendarFeed } from '../hooks/useCalendarFeed'
import { useDocumentIntakeTokens } from '../hooks/useDocumentIntakeTokens'
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
  const documentIntakeTokens = useDocumentIntakeTokens(household.id)
  // A push subscription is tagged to the signed-in member, so it waits on the
  // members load; null until then, which only blocks subscribing.
  const currentMemberId = members?.find((member) => member.user_id === session.user.id)?.id ?? null
  const push = usePushNotifications(household.id, currentMemberId)
  const notificationPreferences = useNotificationPreferences(household.id, currentMemberId)
  const calendarFeed = useCalendarFeed()

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
      documentIntakeStatuses={documentIntakeTokens.statuses}
      documentIntakeBusy={documentIntakeTokens.busy}
      onCreateDocumentIntakeToken={documentIntakeTokens.create}
      onRevokeDocumentIntakeToken={documentIntakeTokens.revoke}
      push={push}
      notificationPreferences={NOTIFICATION_TRIGGERS.map((trigger) => ({
        trigger,
        enabled: notificationPreferences.enabled(trigger),
      }))}
      onToggleNotificationPreference={(trigger, next) =>
        void notificationPreferences.setEnabled(trigger, next)
      }
      calendarFeed={{
        status: calendarFeed.status,
        onCreate: calendarFeed.create,
        onRevoke: calendarFeed.revoke,
      }}
      onSignOut={() => void supabase.auth.signOut()}
    />
  )
}
