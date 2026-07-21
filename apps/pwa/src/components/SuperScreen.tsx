import { Stack, Text, Title } from '@mantine/core'
import type { Account } from '../hooks/useAccounts'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution, SuperContributionInput } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import { accruedBalanceCents } from '../lib/super'
import type { SuperCapSummary } from '../lib/tax'
import { RetirementProjection } from './RetirementProjection'
import { SuperCapsSummary } from './SuperCapsSummary'
import { SuperContributionList } from './SuperContributionList'
import { SuperProfileForm, type SuperFormValues } from './SuperProfileForm'

interface SuperScreenProps {
  members: Member[]
  profiles: SuperProfile[]
  accounts: Account[]
  contributions: SuperContribution[]
  capSummaries: ReadonlyMap<string, SuperCapSummary>
  /** Per-member net annual contribution landing in super, for the projection. */
  netContributionByMember: ReadonlyMap<string, number>
  /** Default retirement age when the household has not set one. */
  preservationAge: number
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
  netContributionByMember,
  preservationAge,
  financialYear,
  onSave,
  onCreateContribution,
  onUpdateContribution,
  onDeleteContribution,
}: SuperScreenProps) {
  return (
    <Stack gap="sm">
      <Title order={2} visibleFrom="sm">
        Super (FY{financialYear})
      </Title>
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
              balanceAsOf={profile?.balance_as_of ?? null}
              netAnnualContributionCents={netContributionByMember.get(member.id) ?? 0}
              onSubmit={(values) => onSave(member, values)}
            />
            {capSummary && <SuperCapsSummary summary={capSummary} />}
            <Title order={3} size="h5">
              Contributions
            </Title>
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

      <RetirementProjection
        preservationAge={preservationAge}
        entries={members.map((member) => {
          const profile = profiles.find((candidate) => candidate.member_id === member.id)
          const account = accounts.find((candidate) => candidate.id === profile?.linked_account_id)
          const netAnnualContributionCents = netContributionByMember.get(member.id) ?? 0
          return {
            member,
            currentBalanceCents: accruedBalanceCents(
              account?.balance_cents ?? 0,
              profile?.balance_as_of ?? null,
              netAnnualContributionCents,
              new Date(),
            ),
            netAnnualContributionCents,
          }
        })}
      />
    </Stack>
  )
}
