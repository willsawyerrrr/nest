import { Stack, Text, Title } from '@mantine/core'
import type { Account } from '../hooks/useAccounts'
import type { Member } from '../hooks/useMembers'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import type { SuperContribution, SuperContributionInput } from '../hooks/useSuperContributions'
import type { SuperCapSummary } from '../lib/tax'
import { SuperProfileForm, type SuperFormValues } from './SuperProfileForm'
import { SuperContributionList } from './SuperContributionList'
import { SuperCapsSummary } from './SuperCapsSummary'

interface SuperScreenProps {
  members: Member[]
  profiles: SuperProfile[]
  accounts: Account[]
  contributions: SuperContribution[]
  capSummaries: ReadonlyMap<string, SuperCapSummary>
  financialYear: number
  onSave: (member: Member, values: SuperFormValues) => Promise<void>
  onCreateContribution: (input: SuperContributionInput) => Promise<void>
  onUpdateContribution: (id: string, input: SuperContributionInput) => Promise<void>
  onDeleteContribution: (id: string) => Promise<void>
}

/**
 * Presentational superannuation manager: one editor per household member for the
 * current financial year. Each member's fund name and balance are read from
 * their super profile and its linked account, and their contributions are listed
 * below for add/edit/delete; persistence lives in the caller.
 */
export function SuperScreen({
  members,
  profiles,
  accounts,
  contributions,
  capSummaries,
  financialYear,
  onSave,
  onCreateContribution,
  onUpdateContribution,
  onDeleteContribution,
}: SuperScreenProps) {
  return (
    <Stack gap="sm">
      <Title order={2}>Super (FY{financialYear})</Title>
      <Text c="dimmed" size="sm">
        Each member&rsquo;s balance is held as an account and counts toward net worth. Concessional
        contributions reduce their taxable income on the Tax tab.
      </Text>

      {members.map((member) => {
        const profile = profiles.find((candidate) => candidate.member_id === member.id)
        const account = accounts.find((candidate) => candidate.id === profile?.linked_account_id)
        const memberContributions = contributions.filter(
          (contribution) => contribution.member_id === member.id,
        )
        const capSummary = capSummaries.get(member.id)
        return (
          <Stack key={member.id} gap="xs">
            <SuperProfileForm
              member={member}
              initialFundName={profile?.fund_name}
              initialBalanceCents={account?.balance_cents}
              onSubmit={(values) => onSave(member, values)}
            />
            {capSummary && <SuperCapsSummary summary={capSummary} />}
            <Text fw={600} size="sm">
              Contributions
            </Text>
            <SuperContributionList
              member={member}
              members={members}
              contributions={memberContributions}
              onCreate={onCreateContribution}
              onUpdate={onUpdateContribution}
              onDelete={onDeleteContribution}
            />
          </Stack>
        )
      })}
    </Stack>
  )
}
