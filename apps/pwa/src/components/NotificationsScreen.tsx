import type { NotificationTrigger } from '../hooks/useNotificationPreferences'
import type { UsePushNotificationsResult } from '../hooks/usePushNotifications'
import { PageSection } from './PageSection'
import { PushNotificationsCard, type NotificationPreferenceToggle } from './PushNotificationsCard'

interface NotificationsScreenProps {
  push: UsePushNotificationsResult
  notificationPreferences: NotificationPreferenceToggle[]
  onToggleNotificationPreference: (trigger: NotificationTrigger, next: boolean) => void
}

/** Presentational push-notification settings: device opt-in and per-trigger toggles. */
export function NotificationsScreen({
  push,
  notificationPreferences,
  onToggleNotificationPreference,
}: NotificationsScreenProps) {
  return (
    <PageSection title="Notifications">
      <PushNotificationsCard
        status={push.status}
        pending={push.pending}
        error={push.error}
        testResult={push.testResult}
        onEnable={() => void push.subscribe()}
        onDisable={() => void push.unsubscribe()}
        onSendTest={() => void push.sendTest()}
        preferences={notificationPreferences}
        onTogglePreference={onToggleNotificationPreference}
      />
    </PageSection>
  )
}
