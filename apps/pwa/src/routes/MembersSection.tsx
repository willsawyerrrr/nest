import { LoadingScreen } from '../components/LoadingScreen'
import { MembersScreen } from '../components/MembersScreen'
import { useMembers } from '../hooks/useMembers'
import { useTaxProfiles } from '../hooks/useTaxProfiles'

export function MembersSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading, setDateOfBirth } = useMembers()
  const taxProfiles = useTaxProfiles(householdId)

  if (membersLoading || taxProfiles.loading || !members) {
    return <LoadingScreen />
  }

  return (
    <MembersScreen
      members={members}
      taxProfiles={taxProfiles.profiles ?? []}
      financialYear={taxProfiles.financialYear}
      onUpsertTaxProfile={async ({ profile, dateOfBirth }) => {
        await taxProfiles.upsert(profile)
        await setDateOfBirth(profile.member_id, dateOfBirth)
      }}
    />
  )
}
