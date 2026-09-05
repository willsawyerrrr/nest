import type { Session } from '@supabase/supabase-js'
import { LoadingScreen } from '../components/LoadingScreen'
import { NotificationsScreen } from '../components/NotificationsScreen'
import { useMembers } from '../hooks/useMembers'
import {
  NOTIFICATION_TRIGGERS,
  useNotificationPreferences,
} from '../hooks/useNotificationPreferences'
import { usePushNotifications } from '../hooks/usePushNotifications'

export function NotificationsSection({
  householdId,
  session,
}: {
  householdId: string
  session: Session
}) {
  const { members, loading: membersLoading } = useMembers()
  // A push subscription is tagged to the signed-in member, so it waits on the
  // members load; null until then, which only blocks subscribing.
  const currentMemberId = members?.find((member) => member.user_id === session.user.id)?.id ?? null
  const push = usePushNotifications(householdId, currentMemberId)
  const notificationPreferences = useNotificationPreferences(householdId, currentMemberId)

  if (membersLoading || !members) {
    return <LoadingScreen />
  }

  return (
    <NotificationsScreen
      push={push}
      notificationPreferences={NOTIFICATION_TRIGGERS.map((trigger) => ({
        trigger,
        enabled: notificationPreferences.enabled(trigger),
      }))}
      onToggleNotificationPreference={(trigger, next) =>
        void notificationPreferences.setEnabled(trigger, next)
      }
    />
  )
}
