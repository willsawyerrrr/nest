import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core'
import type { NotificationTrigger } from '../hooks/useNotificationPreferences'
import type { PushAction, PushStatus } from '../hooks/usePushNotifications'
import { AppCard } from './AppCard'

/** One trigger's on/off state for the signed-in member. */
export interface NotificationPreferenceToggle {
  trigger: NotificationTrigger
  enabled: boolean
}

/** How each trigger reads in the settings list. */
const TRIGGER_COPY: Record<NotificationTrigger, { label: string; detail: string }> = {
  buffer_negative: {
    label: 'Buffer goes negative',
    detail: "When this fortnight's plan spends more than comes in.",
  },
  goal_eta_slipped: {
    label: 'A savings goal slips',
    detail: 'When a dated goal falls behind its target date.',
  },
  temporary_item_expiring: {
    label: 'A temporary item is ending',
    detail: "About two weeks before a temporary item's end date.",
  },
  fy_boundary: {
    label: 'End of the financial year',
    detail: 'About two weeks before 30 June, to review your tax settings.',
  },
}

export interface PushNotificationsCardProps {
  status: PushStatus
  pending: PushAction | null
  error: string | null
  testResult: string | null
  onEnable: () => void
  onDisable: () => void
  onSendTest: () => void
  /** The signed-in member's per-trigger choices; shown only once this device is on. */
  preferences: NotificationPreferenceToggle[]
  /** Toggles one trigger for the signed-in member. */
  onTogglePreference: (trigger: NotificationTrigger, next: boolean) => void
}

/**
 * How each resolved device state reads: a status badge and the one line that
 * says what, if anything, the household can do about it. Every state names its
 * own cause — an iOS tab that only needs installing, a permission the browser
 * will never re-prompt for — rather than collapsing into a generic failure.
 */
const DEVICE_STATES: Record<
  Exclude<PushStatus, 'checking'>,
  { label: string; color: string; detail: string }
> = {
  unsupported: {
    label: 'Unavailable',
    color: 'gray',
    detail: 'This browser cannot show push notifications.',
  },
  'needs-install': {
    label: 'Not installed',
    color: 'warning',
    detail:
      'Add nest to your home screen first — iOS delivers notifications only to the installed app.',
  },
  denied: {
    label: 'Blocked',
    color: 'negative',
    detail:
      'Notifications are blocked for this device. Allow them in your device settings; nest cannot ask again.',
  },
  'not-subscribed': {
    label: 'Off',
    color: 'gray',
    detail: 'Turn notifications on to get them on this device.',
  },
  subscribed: {
    label: 'On',
    color: 'positive',
    detail: 'This device is registered for notifications.',
  },
}

/**
 * The notification card for the device the app is running on: its state, the
 * control that flips it, and a test push that proves the chain reaches the
 * device. Notifications are per-device, so nothing here reflects the household's
 * other devices. Data wiring lives in the caller.
 */
export function PushNotificationsCard({
  status,
  pending,
  error,
  testResult,
  onEnable,
  onDisable,
  onSendTest,
  preferences,
  onTogglePreference,
}: PushNotificationsCardProps) {
  return (
    <AppCard>
      <Stack gap="md">
        <Title order={3} size="h5">
          Notifications
        </Title>

        {status === 'checking' ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Checking this device…
            </Text>
          </Group>
        ) : (
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Badge size="sm" color={DEVICE_STATES[status].color}>
                {DEVICE_STATES[status].label}
              </Badge>
              {status === 'subscribed' && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  loading={pending === 'toggle'}
                  onClick={onDisable}
                >
                  Turn off
                </Button>
              )}
              {status === 'not-subscribed' && (
                <Button size="xs" variant="light" loading={pending === 'toggle'} onClick={onEnable}>
                  Turn on
                </Button>
              )}
            </Group>

            <Text size="sm" c="dimmed">
              {DEVICE_STATES[status].detail}
            </Text>

            <Button
              variant="default"
              fullWidth
              disabled={status !== 'subscribed' || pending === 'toggle'}
              loading={pending === 'test'}
              onClick={onSendTest}
            >
              Send test notification
            </Button>

            {status === 'subscribed' && preferences.length > 0 && (
              <>
                <Divider mt="xs" label="Notify me about" labelPosition="left" />
                <Stack gap="sm">
                  {preferences.map(({ trigger, enabled }) => (
                    <Switch
                      key={trigger}
                      checked={enabled}
                      onChange={(event) => onTogglePreference(trigger, event.currentTarget.checked)}
                      label={TRIGGER_COPY[trigger].label}
                      description={TRIGGER_COPY[trigger].detail}
                    />
                  ))}
                </Stack>
                <Text size="xs" c="dimmed">
                  These apply to every device you've turned on.
                </Text>
              </>
            )}
          </Stack>
        )}

        {testResult !== null && (
          <Alert color="positive" variant="light">
            {testResult}
          </Alert>
        )}

        {error !== null && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
      </Stack>
    </AppCard>
  )
}
