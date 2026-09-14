import type { Session } from '@supabase/supabase-js'
import { ConnectionsScreen } from '../components/ConnectionsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useCalendarFeed } from '../hooks/useCalendarFeed'
import { useMembers } from '../hooks/useMembers'
import { useRedbarkConnections } from '../hooks/useRedbarkConnections'
import { useUpConnection } from '../hooks/useUpConnection'

/** The route this screen lives at, and the return address the Redbark consent redirect lands back on. */
const CONNECTIONS_PATH = '/settings/connections'

export function ConnectionsSection({ session }: { session: Session }) {
  const { members, loading: membersLoading, reload: reloadMembers } = useMembers()
  const up = useUpConnection(reloadMembers)
  const redbark = useRedbarkConnections()
  const calendarFeed = useCalendarFeed()

  if (membersLoading || !members) {
    return <LoadingScreen />
  }

  return (
    <ConnectionsScreen
      currentUserId={session.user.id}
      members={members}
      onConnectUp={up.connect}
      onDisconnectUp={up.disconnect}
      upBusy={up.busy}
      redbark={{
        connections: redbark.connections ?? [],
        busy: redbark.busy,
        onConnect: () => redbark.connect(window.location.origin + CONNECTIONS_PATH),
        onDisconnect: redbark.disconnect,
        completeResult: redbark.completeResult,
        onDismissCompleteResult: redbark.dismissCompleteResult,
      }}
      calendarFeed={{
        status: calendarFeed.status,
        onCreate: calendarFeed.create,
        onRevoke: calendarFeed.revoke,
      }}
    />
  )
}
