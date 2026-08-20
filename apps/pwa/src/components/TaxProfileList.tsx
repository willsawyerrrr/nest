import { useState } from 'react'
import { Badge, Group, Stack, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileSubmission } from '../hooks/useTaxProfiles'
import { AppCard } from './AppCard'
import { EditAction } from './EditAction'
import { TaxProfileForm } from './TaxProfileForm'

interface TaxProfileListProps {
  members: Member[]
  profiles: TaxProfile[]
  onUpsert: (submission: TaxProfileSubmission) => Promise<void>
}

/** One member's tax profile as a compact read-only row: residency and cover. */
function TaxProfileCard({
  member,
  profile,
  onEdit,
}: {
  member: Member
  profile?: TaxProfile | undefined
  onEdit: () => void
}) {
  const foreign = profile?.residency === 'foreign_resident'
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {member.name}
          </Text>
          <Group gap={6} wrap="wrap">
            <Badge size="xs" variant="light">
              {foreign ? 'Foreign resident' : 'Resident'}
            </Badge>
            {profile?.has_private_hospital_cover && (
              <Badge size="xs" variant="light" color="teal">
                Hospital cover
              </Badge>
            )}
          </Group>
        </Stack>
        <EditAction onClick={onEdit} style={{ flexShrink: 0 }} />
      </Group>
    </AppCard>
  )
}

/** Per-member tax profiles, each a compact row that expands into an inline edit form. */
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
          <TaxProfileCard
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
