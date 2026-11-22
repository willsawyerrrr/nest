import { AccountsScreen } from '../components/AccountsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useAccounts } from '../hooks/useAccounts'
import { useMembers } from '../hooks/useMembers'

export function AccountsSection() {
  const { accounts, loading } = useAccounts()
  const { members, loading: membersLoading } = useMembers()

  if (loading || membersLoading || !accounts || !members) {
    return <LoadingScreen />
  }

  return <AccountsScreen accounts={accounts} members={members} />
}
