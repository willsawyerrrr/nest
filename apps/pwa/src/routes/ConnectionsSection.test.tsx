import type { Session } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { ConnectionsSection } from './ConnectionsSection'

const hooks = vi.hoisted(() => ({
  useMembers: vi.fn(),
  useUpConnection: vi.fn(),
  useRedbarkConnections: vi.fn(),
  useCalendarFeed: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}))

vi.mock('../components/LoadingScreen', () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}))
vi.mock('../hooks/useMembers', () => ({ useMembers: hooks.useMembers }))
vi.mock('../hooks/useUpConnection', () => ({ useUpConnection: hooks.useUpConnection }))
vi.mock('../hooks/useRedbarkConnections', () => ({
  useRedbarkConnections: hooks.useRedbarkConnections,
}))
vi.mock('../hooks/useCalendarFeed', () => ({ useCalendarFeed: hooks.useCalendarFeed }))
vi.mock('../components/ConnectionsScreen', () => ({
  ConnectionsScreen: (props: Record<string, unknown>) => {
    hooks.screenProps = props
    return <div data-testid="connections-screen" />
  },
}))

const session = { user: { id: 'u1', email: 'a@example.com' } } as unknown as Session

describe('ConnectionsSection', () => {
  beforeEach(() => {
    hooks.screenProps = null
    hooks.useCalendarFeed.mockReturnValue({
      status: null,
      loading: false,
      reload: vi.fn(),
      create: vi.fn().mockResolvedValue('tok'),
      revoke: vi.fn().mockResolvedValue(undefined),
    })
    hooks.useRedbarkConnections.mockReturnValue({
      connections: [],
      loading: false,
      busy: false,
      reload: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      completeResult: null,
      dismissCompleteResult: vi.fn(),
    })
  })

  it('shows the loading screen until members load', () => {
    hooks.useMembers.mockReturnValue({ members: null, loading: true, reload: vi.fn() })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })

    render(<ConnectionsSection session={session} />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('renders the connections screen with the signed-in member id', () => {
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex', user_id: 'u1' }],
      loading: false,
      reload: vi.fn(),
    })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })

    render(<ConnectionsSection session={session} />)

    expect(screen.getByTestId('connections-screen')).toBeInTheDocument()
    expect(hooks.screenProps).toMatchObject({ currentUserId: 'u1' })
  })

  it('wires the Redbark connections and a return URL through to the screen', () => {
    const connect = vi.fn()
    const disconnect = vi.fn()
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex', user_id: 'u1' }],
      loading: false,
      reload: vi.fn(),
    })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })
    hooks.useRedbarkConnections.mockReturnValue({
      connections: [{ id: 'c1', member_id: 'm1', institution_name: 'Big Bank', status: 'active' }],
      loading: false,
      busy: false,
      reload: vi.fn(),
      connect,
      disconnect,
      completeResult: null,
      dismissCompleteResult: vi.fn(),
    })

    render(<ConnectionsSection session={session} />)

    const redbark = hooks.screenProps!.redbark as {
      connections: unknown[]
      onConnect: () => Promise<void>
      onDisconnect: (id: string) => Promise<void>
    }
    expect(redbark.connections).toEqual([
      { id: 'c1', member_id: 'm1', institution_name: 'Big Bank', status: 'active' },
    ])
    void redbark.onConnect()
    expect(connect).toHaveBeenCalledWith(`${window.location.origin}/settings/connections`)
    void redbark.onDisconnect('c1')
    expect(disconnect).toHaveBeenCalledWith('c1')
  })

  it('wires the calendar feed status and actions through to the screen', () => {
    const create = vi.fn().mockResolvedValue('tok')
    const revoke = vi.fn().mockResolvedValue(undefined)
    hooks.useCalendarFeed.mockReturnValue({
      status: { household_id: 'h1', created_at: '2027-01-01T00:00:00Z' },
      loading: false,
      reload: vi.fn(),
      create,
      revoke,
    })
    hooks.useMembers.mockReturnValue({
      members: [{ id: 'm1', name: 'Alex', user_id: 'u1' }],
      loading: false,
      reload: vi.fn(),
    })
    hooks.useUpConnection.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), busy: false })

    render(<ConnectionsSection session={session} />)

    const calendarFeed = hooks.screenProps!.calendarFeed as {
      status: { household_id: string } | null
      onCreate: () => Promise<string>
      onRevoke: () => Promise<void>
    }
    expect(calendarFeed.status).toEqual({ household_id: 'h1', created_at: '2027-01-01T00:00:00Z' })
    expect(calendarFeed.onCreate).toBe(create)
    expect(calendarFeed.onRevoke).toBe(revoke)
  })
})
