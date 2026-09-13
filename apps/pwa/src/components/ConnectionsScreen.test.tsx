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
      redbark={{
        connections: [],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        completeResult: null,
        onDismissCompleteResult: vi.fn(),
      }}
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

  it('starts a Redbark connection', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    renderConnections({
      redbark: {
        connections: [],
        busy: false,
        onConnect,
        onDisconnect: vi.fn(),
        completeResult: null,
        onDismissCompleteResult: vi.fn(),
      },
    })

    await user.click(screen.getByRole('button', { name: /^connect a bank$/i }))
    expect(onConnect).toHaveBeenCalledOnce()
  })

  it('lists Redbark connections with the owning member and status', () => {
    renderConnections({
      redbark: {
        connections: [
          {
            id: 'c1',
            household_id: 'h1',
            member_id: 'm1',
            institution_name: 'Big Bank',
            status: 'active',
            created_at: '',
            updated_at: '',
          },
          {
            id: 'c2',
            household_id: 'h1',
            member_id: 'm2',
            institution_name: 'Other Bank',
            status: 'active',
            created_at: '',
            updated_at: '',
          },
        ],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        completeResult: null,
        onDismissCompleteResult: vi.fn(),
      },
    })

    const card = screen
      .getByRole('heading', { name: /^connect a bank$/i })
      .closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText('Big Bank')).toBeInTheDocument()
    expect(within(card).getByText('Will')).toBeInTheDocument()
    expect(within(card).getByText('Other Bank')).toBeInTheDocument()
    expect(within(card).getByText('Sam')).toBeInTheDocument()
    // Disconnect is offered for the signed-in member's own connection only.
    expect(within(card).getAllByRole('button', { name: /disconnect/i })).toHaveLength(1)
  })

  it('disconnects a Redbark connection', async () => {
    const user = userEvent.setup()
    const onDisconnect = vi.fn()
    renderConnections({
      redbark: {
        connections: [
          {
            id: 'c1',
            household_id: 'h1',
            member_id: 'm1',
            institution_name: 'Big Bank',
            status: 'active',
            created_at: '',
            updated_at: '',
          },
        ],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect,
        completeResult: null,
        onDismissCompleteResult: vi.fn(),
      },
    })

    await user.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(onDisconnect).toHaveBeenCalledWith('c1')
  })

  it('shows a success banner after connecting and dismisses it', async () => {
    const user = userEvent.setup()
    const onDismissCompleteResult = vi.fn()
    renderConnections({
      redbark: {
        connections: [],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        completeResult: { status: 'connected' },
        onDismissCompleteResult,
      },
    })

    expect(screen.getByText('Bank connected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismissCompleteResult).toHaveBeenCalledOnce()
  })

  it('shows the failure reason in the error banner', () => {
    renderConnections({
      redbark: {
        connections: [],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        completeResult: { status: 'failed', reason: 'Consent was declined' },
        onDismissCompleteResult: vi.fn(),
      },
    })

    expect(screen.getByText('Connection failed')).toBeInTheDocument()
    expect(screen.getByText('Consent was declined')).toBeInTheDocument()
  })

  it('shows a pending banner when the connection has not finished yet', () => {
    renderConnections({
      redbark: {
        connections: [],
        busy: false,
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        completeResult: { status: 'pending' },
        onDismissCompleteResult: vi.fn(),
      },
    })

    expect(screen.getByText('Still connecting')).toBeInTheDocument()
  })
})
