import { Stack, Text, Title } from '@mantine/core'
import type { Account } from '../hooks/useAccounts'
import type { Member } from '../hooks/useMembers'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import { SuperProfileForm, type SuperFormValues } from './SuperProfileForm'

interface SuperScreenProps {
  members: Member[]
  profiles: SuperProfile[]
  accounts: Account[]
  financialYear: number
  onSave: (member: Member, values: SuperFormValues) => Promise<void>
}

/**
 * Presentational superannuation manager: one editor per household member for the
 * current financial year. Each member's fund name and balance are read from
 * their super profile and its linked account; persistence lives in the caller.
 */
export function SuperScreen({
  members,
  profiles,
  accounts,
  financialYear,
  onSave,
}: SuperScreenProps) {
  return (
    <Stack gap="sm">
      <Title order={2}>Super (FY{financialYear})</Title>
      <Text c="dimmed" size="sm">
        Each member&rsquo;s balance is held as an account and counts toward net worth.
      </Text>

      {members.map((member) => {
        const profile = profiles.find((candidate) => candidate.member_id === member.id)
        const account = accounts.find((candidate) => candidate.id === profile?.linked_account_id)
        return (
          <SuperProfileForm
            key={member.id}
            member={member}
            initialFundName={profile?.fund_name}
            initialBalanceCents={account?.balance_cents}
            onSubmit={(values) => onSave(member, values)}
          />
        )
      })}
    </Stack>
  )
}
