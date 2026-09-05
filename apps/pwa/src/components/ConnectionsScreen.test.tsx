import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { fireEvent, render, screen, within } from '../test/render'
import { ConnectionsScreen } from './ConnectionsScreen'

const members = [
  makeMember({ id: 'm1', name: 'Will', user_id: 'u1' }),
  makeMember({ id: 'm2', name: 'Sam', user_id: 'u2' }),
]

function renderConnections(overrides: Partial<Parameters<typeof ConnectionsScreen>[0]> = {}) {
  return render(
    <ConnectionsScreen
      currentUserId="u1"
      members={members}
      onConnectUp={vi.fn()}
      onDisconnectUp={vi.fn()}
      upBusy={false}
      calendarFeed={{
        status: null,
        onCreate: vi.fn().mockResolvedValue('tok'),
        onRevoke: vi.fn().mockResolvedValue(undefined),
      }}
      {...overrides}
    />,
  )
}

describe('ConnectionsScreen', () => {
  it('renders the page title', () => {
    renderConnections()

    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument()
  })

  it('renders the calendar feed card and generates a feed', async () => {
    const onCreate = vi.fn().mockResolvedValue('tok')
    renderConnections({ calendarFeed: { status: null, onCreate, onRevoke: vi.fn() } })

    expect(screen.getByRole('heading', { name: 'Calendar feed' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /generate calendar feed/i }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('offers a token field and connects the signed-in member', async () => {
    const user = userEvent.setup()
    const onConnectUp = vi.fn()
    renderConnections({ onConnectUp })

    expect(screen.getByRole('heading', { name: /Connect Up/ })).toBeInTheDocument()
    const field = screen.getByLabelText(/Up personal access token/i)
    await user.type(field, 'up:yeah:secret')
    await user.click(screen.getByRole('button', { name: /^connect$/i }))

    expect(onConnectUp).toHaveBeenCalledWith('up:yeah:secret')
  })

  it('shows Connected and a disconnect action when the signed-in member is connected', () => {
    const onDisconnectUp = vi.fn()
    const connectedMembers = members.map((member) =>
      member.user_id === 'u1' ? { ...member, up_connected_at: new Date().toISOString() } : member,
    )
    renderConnections({ members: connectedMembers, onDisconnectUp })

    const card = screen
      .getByRole('heading', { name: /Connect Up/ })
      .closest('.mantine-Card-root') as HTMLElement
    // The status badge, plus Will's own row in the per-member list.
    expect(within(card).getAllByText('Connected')).toHaveLength(2)
    expect(screen.queryByLabelText(/Up personal access token/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(onDisconnectUp).toHaveBeenCalledOnce()
  })

  it('lists each member connection status', () => {
    const connectedMembers = members.map((member) =>
      member.user_id === 'u2' ? { ...member, up_connected_at: new Date().toISOString() } : member,
    )
    renderConnections({ members: connectedMembers })

    const card = screen
      .getByRole('heading', { name: /Connect Up/ })
      .closest('.mantine-Card-root') as HTMLElement
    // Will (u1) not connected, Sam (u2) connected.
    expect(within(card).getByText('Not connected')).toBeInTheDocument()
    expect(within(card).getAllByText('Connected')).toHaveLength(1)
  })
})
