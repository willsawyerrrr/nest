import { describe, expect, it, vi } from 'vitest'
import type { UsePushNotificationsResult } from '../hooks/usePushNotifications'
import { fireEvent, render, screen } from '../test/render'
import { NotificationsScreen } from './NotificationsScreen'

const push = {
  status: 'not-subscribed',
  pending: null,
  error: null,
  testResult: null,
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  sendTest: vi.fn().mockResolvedValue(undefined),
} satisfies UsePushNotificationsResult

function renderNotifications(overrides: Partial<Parameters<typeof NotificationsScreen>[0]> = {}) {
  return render(
    <NotificationsScreen
      push={push}
      notificationPreferences={[
        { trigger: 'buffer_negative', enabled: true },
        { trigger: 'goal_eta_slipped', enabled: true },
        { trigger: 'temporary_item_expiring', enabled: true },
        { trigger: 'fy_boundary', enabled: true },
      ]}
      onToggleNotificationPreference={vi.fn()}
      {...overrides}
    />,
  )
}

describe('NotificationsScreen', () => {
  it('renders the page title', () => {
    renderNotifications()

    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('offers to turn notifications on for this device', () => {
    const subscribe = vi.fn().mockResolvedValue(undefined)
    renderNotifications({ push: { ...push, subscribe } })

    expect(screen.getByRole('heading', { name: /Notifications/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /turn on/i }))

    expect(subscribe).toHaveBeenCalledOnce()
  })

  it('offers to turn a registered device off and to send it a test', () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const sendTest = vi.fn().mockResolvedValue(undefined)
    renderNotifications({ push: { ...push, status: 'subscribed', unsubscribe, sendTest } })

    fireEvent.click(screen.getByRole('button', { name: /send test notification/i }))
    fireEvent.click(screen.getByRole('button', { name: /turn off/i }))

    expect(sendTest).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
