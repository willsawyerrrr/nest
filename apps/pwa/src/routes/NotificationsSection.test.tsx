import type { Session } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { NotificationsSection } from './NotificationsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useNotificationPreferences: vi.fn(),
  usePushNotifications: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/usePushNotifications', () => ({
  usePushNotifications: hooks.usePushNotifications,
}))
vi.mock('../hooks/useNotificationPreferences', () => ({
  NOTIFICATION_TRIGGERS: [
    'buffer_negative',
    'goal_eta_slipped',
    'temporary_item_expiring',
    'fy_boundary',
  ],
  useNotificationPreferences: hooks.useNotificationPreferences,
}))
vi.mock('../components/NotificationsScreen', () => ({
  NotificationsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="notifications-screen" />
  },
}))

const session = { user: { id: 'u1' } } as unknown as Session

describe('NotificationsSection', () => {
  beforeEach(() => {
    hooks.screenProps = null
    hooks.usePushNotifications.mockReturnValue({
      status: 'not-subscribed',
      pending: null,
      error: null,
      testResult: null,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      sendTest: vi.fn(),
    })
  })

  it('shows the loading screen until members load', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true })
    hooks.useNotificationPreferences.mockReturnValue({
      loading: false,
      enabled: () => true,
      setEnabled: vi.fn(),
    })

    render(<NotificationsSection session={session} />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('passes each trigger through and toggles one for the member', () => {
    const setEnabled = vi.fn().mockResolvedValue(undefined)
    hooks.useNotificationPreferences.mockReturnValue({
      loading: false,
      enabled: (trigger: string) => trigger !== 'fy_boundary',
      setEnabled,
    })
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex', user_id: 'u1' }],
      loading: false,
    })

    render(<NotificationsSection session={session} />)

    const prefs = hooks.screenProps!.notificationPreferences as Array<{
      trigger: string
      enabled: boolean
    }>
    expect(prefs).toEqual([
      { trigger: 'buffer_negative', enabled: true },
      { trigger: 'goal_eta_slipped', enabled: true },
      { trigger: 'temporary_item_expiring', enabled: true },
      { trigger: 'fy_boundary', enabled: false },
    ])
    const toggle = hooks.screenProps!.onToggleNotificationPreference as (
      trigger: string,
      next: boolean,
    ) => void
    toggle('goal_eta_slipped', false)
    expect(setEnabled).toHaveBeenCalledWith('goal_eta_slipped', false)
  })

  it('resolves the current member id from the signed-in session', () => {
    hooks.useNotificationPreferences.mockReturnValue({
      loading: false,
      enabled: () => true,
      setEnabled: vi.fn(),
    })
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex', user_id: 'u1' }],
      loading: false,
    })

    render(<NotificationsSection session={session} />)

    expect(hooks.usePushNotifications).toHaveBeenCalledWith('m1')
    expect(hooks.useNotificationPreferences).toHaveBeenCalledWith('m1')
  })

  it('passes a null member id when the signed-in user matches no member', () => {
    hooks.useNotificationPreferences.mockReturnValue({
      loading: false,
      enabled: () => true,
      setEnabled: vi.fn(),
    })
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex', user_id: 'other' }],
      loading: false,
    })

    render(<NotificationsSection session={session} />)

    expect(hooks.usePushNotifications).toHaveBeenCalledWith(null)
  })
})
