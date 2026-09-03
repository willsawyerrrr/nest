import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../test/render'
import { PushNotificationsCard } from './PushNotificationsCard'

function renderCard(overrides: Partial<Parameters<typeof PushNotificationsCard>[0]> = {}) {
  return render(
    <PushNotificationsCard
      status="not-subscribed"
      pending={null}
      error={null}
      testResult={null}
      onEnable={vi.fn()}
      onDisable={vi.fn()}
      onSendTest={vi.fn()}
      preferences={[
        { trigger: 'buffer_negative', enabled: true },
        { trigger: 'goal_eta_slipped', enabled: false },
        { trigger: 'temporary_item_expiring', enabled: true },
        { trigger: 'fy_boundary', enabled: true },
      ]}
      onTogglePreference={vi.fn()}
      {...overrides}
    />,
  )
}

const testButton = () => screen.getByRole('button', { name: /send test notification/i })

describe('PushNotificationsCard', () => {
  it('shows the device being probed, with no controls yet', () => {
    renderCard({ status: 'checking' })

    expect(screen.getByText(/checking this device/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says an unsupported browser cannot show notifications', () => {
    renderCard({ status: 'unsupported' })

    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText(/cannot show push notifications/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on/i })).not.toBeInTheDocument()
    expect(testButton()).toBeDisabled()
  })

  it('tells an iOS browser tab to install to the home screen first', () => {
    renderCard({ status: 'needs-install' })

    expect(screen.getByText('Not installed')).toBeInTheDocument()
    expect(screen.getByText(/add nest to your home screen/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on/i })).not.toBeInTheDocument()
    expect(testButton()).toBeDisabled()
  })

  it('says a blocked permission cannot be asked for again', () => {
    renderCard({ status: 'denied' })

    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText(/nest cannot ask again/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on/i })).not.toBeInTheDocument()
    expect(testButton()).toBeDisabled()
  })

  it('offers to turn an unregistered device on', () => {
    const onEnable = vi.fn()
    renderCard({ onEnable })

    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(testButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /turn on/i }))

    expect(onEnable).toHaveBeenCalledOnce()
  })

  it('offers to turn a registered device off and to test it', () => {
    const onDisable = vi.fn()
    const onSendTest = vi.fn()
    renderCard({ status: 'subscribed', onDisable, onSendTest })

    expect(screen.getByText('On')).toBeInTheDocument()
    expect(testButton()).toBeEnabled()

    fireEvent.click(testButton())
    fireEvent.click(screen.getByRole('button', { name: /turn off/i }))

    expect(onSendTest).toHaveBeenCalledOnce()
    expect(onDisable).toHaveBeenCalledOnce()
  })

  it('reports what the test send reached', () => {
    renderCard({ status: 'subscribed', testResult: 'Sent to 2 devices.' })

    expect(screen.getByText('Sent to 2 devices.')).toBeInTheDocument()
  })

  it('surfaces a failure', () => {
    renderCard({ error: 'Could not turn on notifications for this device. Try again.' })

    expect(screen.getByText(/could not turn on notifications/i)).toBeInTheDocument()
  })

  it('loads the toggle and blocks the test while the toggle is in flight', () => {
    renderCard({ status: 'subscribed', pending: 'toggle' })

    expect(screen.getByRole('button', { name: /turn off/i })).toHaveAttribute('data-loading')
    expect(testButton()).toBeDisabled()
  })

  it('loads the toggle while an unregistered device is being turned on', () => {
    renderCard({ pending: 'toggle' })

    expect(screen.getByRole('button', { name: /turn on/i })).toHaveAttribute('data-loading')
  })

  it('loads the test button while the test is in flight', () => {
    renderCard({ status: 'subscribed', pending: 'test' })

    expect(testButton()).toHaveAttribute('data-loading')
    expect(screen.getByRole('button', { name: /turn off/i })).not.toHaveAttribute('data-loading')
  })

  it('shows the per-trigger switches only once the device is on', () => {
    renderCard({ status: 'not-subscribed' })
    expect(screen.queryByText('Notify me about')).not.toBeInTheDocument()

    renderCard({ status: 'subscribed' })
    expect(screen.getByText('Notify me about')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /buffer goes negative/i })).toBeChecked()
    expect(screen.getByRole('switch', { name: /a savings goal slips/i })).not.toBeChecked()
  })

  it('toggles a trigger for the member', () => {
    const onTogglePreference = vi.fn()
    renderCard({ status: 'subscribed', onTogglePreference })

    fireEvent.click(screen.getByRole('switch', { name: /a savings goal slips/i }))

    expect(onTogglePreference).toHaveBeenCalledWith('goal_eta_slipped', true)
  })

  it('hides the switches when no preferences are supplied', () => {
    renderCard({ status: 'subscribed', preferences: [] })

    expect(screen.queryByText('Notify me about')).not.toBeInTheDocument()
  })
})
