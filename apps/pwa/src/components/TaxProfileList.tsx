import { useState } from 'react'
import { Badge, Box, Group, Stack, Text } from '@mantine/core'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileSubmission } from '../hooks/useTaxProfiles'
import { formatIsoDate } from '../lib/dates'
import { AppCard } from './AppCard'
import { EditAction } from './EditAction'
import { ListRow } from './ListRow'
import { TaxProfileForm } from './TaxProfileForm'

interface TaxProfileListProps {
  members: Member[]
  profiles: TaxProfile[]
  onUpsert: (submission: TaxProfileSubmission) => Promise<void>
}

interface TaxProfileItemProps {
  member: Member
  profile?: TaxProfile | undefined
  onEdit: () => void
}

/** The residency pill of a tax profile; a member with no profile is a resident. */
function ResidencyBadge({ profile }: { profile?: TaxProfile | undefined }) {
  return (
    <Badge size="xs" variant="light">
      {profile?.residency === 'foreign_resident' ? 'Foreign resident' : 'Resident'}
    </Badge>
  )
}

/** The hospital-cover pill of a tax profile, or a muted note when there is no cover. */
function CoverBadge({ profile }: { profile?: TaxProfile | undefined }) {
  return profile?.has_private_hospital_cover ? (
    <Badge size="xs" variant="light" color="teal">
      Hospital cover
    </Badge>
  ) : (
    <Text size="xs" c="dimmed">
      No hospital cover
    </Text>
  )
}

/** A member's date of birth, or a muted note that none is recorded. */
function dateOfBirthLabel(member: Member): string {
  return member.date_of_birth ? `Born ${formatIsoDate(member.date_of_birth)}` : 'No date of birth'
}

/**
 * One member's tax profile as a dense row for desktop: the name leads, then the
 * residency pill, hospital cover and date of birth in aligned columns, then the
 * edit control.
 */
function TaxProfileRowWide({ member, profile, onEdit }: TaxProfileItemProps) {
  return (
    <ListRow gap="sm" data-testid={`tax-profile-${member.id}`}>
      <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
        {member.name}
      </Text>
      <Box style={{ width: '7rem', flexShrink: 0 }}>
        <ResidencyBadge profile={profile} />
      </Box>
      <Box style={{ width: '8rem', flexShrink: 0 }}>
        <CoverBadge profile={profile} />
      </Box>
      <Text size="xs" c="dimmed" ta="right" style={{ width: '9rem', flexShrink: 0 }}>
        {dateOfBirthLabel(member)}
      </Text>
      <EditAction
        aria-label={`Edit ${member.name}’s tax profile`}
        onClick={onEdit}
        style={{ flexShrink: 0 }}
      />
    </ListRow>
  )
}

/** One member's tax profile as a compact card for mobile: name over pills and date of birth. */
function TaxProfileCard({ member, profile, onEdit }: TaxProfileItemProps) {
  return (
    <AppCard withBorder padding="xs" data-testid={`tax-profile-${member.id}`}>
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {member.name}
          </Text>
          <Group gap={6} wrap="wrap">
            <ResidencyBadge profile={profile} />
            <CoverBadge profile={profile} />
          </Group>
          <Text size="xs" c="dimmed">
            {dateOfBirthLabel(member)}
          </Text>
        </Stack>
        <EditAction
          aria-label={`Edit ${member.name}’s tax profile`}
          onClick={onEdit}
          style={{ flexShrink: 0 }}
        />
      </Group>
    </AppCard>
  )
}

/** One member's tax profile, a dense row from the `md` breakpoint up and a compact card below it. */
function TaxProfileItem(props: TaxProfileItemProps) {
  const wide = useIsWide()
  return wide ? <TaxProfileRowWide {...props} /> : <TaxProfileCard {...props} />
}

/** Per-member tax profiles, each a compact row or card that expands into an inline edit form. */
export function TaxProfileList({ members, profiles, onUpsert }: TaxProfileListProps) {
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const profileForMember = (memberId: string) =>
    profiles.find((profile) => profile.member_id === memberId)

  return (
    <Stack gap="xs">
      {members.map((member) =>
        editingMemberId === member.id ? (
          <TaxProfileForm
            key={member.id}
            member={member}
            initial={profileForMember(member.id)}
            onSubmit={async (submission) => {
              await onUpsert(submission)
              setEditingMemberId(null)
            }}
            onCancel={() => setEditingMemberId(null)}
          />
        ) : (
          <TaxProfileItem
            key={member.id}
            member={member}
            profile={profileForMember(member.id)}
            onEdit={() => setEditingMemberId(member.id)}
          />
        ),
      )}
    </Stack>
  )
}
