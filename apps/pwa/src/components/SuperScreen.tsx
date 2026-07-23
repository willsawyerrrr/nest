import { useState } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'
import type { Account } from '../hooks/useAccounts'
import type { Member } from '../hooks/useMembers'
import type { SuperContribution, SuperContributionInput } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'
import { formatIsoDate } from '../lib/dates'
import { formatCents } from '../lib/money'
import { accruedBalanceCents } from '../lib/super'
import type { SuperCapSummary } from '../lib/tax'
import { AppCard } from './AppCard'
import { EditAction } from './EditAction'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { RetirementProjection } from './RetirementProjection'
import { SuperCapsSummary } from './SuperCapsSummary'
import { SuperContributionList } from './SuperContributionList'
import { SuperProfileForm, type SuperFormValues } from './SuperProfileForm'

/**
 * One member's super profile as a compact read-only row: fund name and the
 * effective balance today. For a dated baseline this reads as an estimate, with
 * the accrual breakdown, since it grows by modelled contributions between true-ups.
 */
function SuperProfileCard({
  member,
  fundName,
  baselineCents,
  balanceAsOf,
  effectiveCents,
  onEdit,
}: {
  member: Member
  fundName?: string | null
  baselineCents: number
  balanceAsOf: string | null
  effectiveCents: number
  onEdit: () => void
}) {
  const isTrueUp = balanceAsOf !== null
  const accruedCents = effectiveCents - baselineCents
  const trimmedFundName = fundName?.trim()
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {member.name}
          </Text>
          {trimmedFundName ? (
            <Text size="sm" c="dimmed" truncate>
              {trimmedFundName}
            </Text>
          ) : (
            <Text size="sm" c="dimmed" fs="italic">
              No fund set
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {isTrueUp ? 'Estimated balance today' : 'Current balance'}
          </Text>
          <MoneyText cents={effectiveCents} fw={700} fz="lg" />
          {isTrueUp && accruedCents !== 0 && (
            <Text size="xs" c="dimmed">
              {formatCents(baselineCents)} confirmed on {formatIsoDate(balanceAsOf)} +{' '}
              {formatCents(accruedCents)} accrued from contributions
            </Text>
          )}
        </Stack>
        <EditAction onClick={onEdit} style={{ flexShrink: 0 }} />
      </Group>
    </AppCard>
  )
}

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
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  return (
    <PageSection
      title={`Super (FY${financialYear})`}
      intro="Each member’s balance is held as an account and counts toward net worth. Concessional contributions reduce their taxable income on the Tax tab."
    >
      {members.map((member) => {
        const profile = profiles.find((candidate) => candidate.member_id === member.id)
        const account = accounts.find((candidate) => candidate.id === profile?.linked_account_id)
        const memberContributions = contributions.filter(
          (contribution) => contribution.member_id === member.id,
        )
        const capSummary = capSummaries.get(member.id)
        const netAnnualContributionCents = netContributionByMember.get(member.id) ?? 0
        const balanceAsOf = profile?.balance_as_of ?? null
        const baselineCents = account?.balance_cents ?? 0
        const effectiveCents = accruedBalanceCents(
          baselineCents,
          balanceAsOf,
          netAnnualContributionCents,
          new Date(),
        )
        return (
          <Stack key={member.id} gap="xs">
            {editingMemberId === member.id ? (
              <SuperProfileForm
                member={member}
                initialFundName={profile?.fund_name}
                initialBalanceCents={account?.balance_cents}
                balanceAsOf={balanceAsOf}
                netAnnualContributionCents={netAnnualContributionCents}
                onSubmit={async (values) => {
                  await onSave(member, values)
                  setEditingMemberId(null)
                }}
                onCancel={() => setEditingMemberId(null)}
              />
            ) : (
              <SuperProfileCard
                member={member}
                fundName={profile?.fund_name}
                baselineCents={baselineCents}
                balanceAsOf={balanceAsOf}
                effectiveCents={effectiveCents}
                onEdit={() => setEditingMemberId(member.id)}
              />
            )}
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
    </PageSection>
  )
}
