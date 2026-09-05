import type { Session } from '@supabase/supabase-js'
import { ConnectionsScreen } from '../components/ConnectionsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useCalendarFeed } from '../hooks/useCalendarFeed'
import { useMembers } from '../hooks/useMembers'
import { useUpConnection } from '../hooks/useUpConnection'

export function ConnectionsSection({ session }: { session: Session }) {
  const { members, loading: membersLoading, reload: reloadMembers } = useMembers()
  const up = useUpConnection(reloadMembers)
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
      calendarFeed={{
        status: calendarFeed.status,
        onCreate: calendarFeed.create,
        onRevoke: calendarFeed.revoke,
      }}
    />
  )
}
