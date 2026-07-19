import { useState } from 'react'
import { ActionIcon, Badge, Card, Group, Stack, Text } from '@mantine/core'
import { IconPencil } from '@tabler/icons-react'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileInput } from '../hooks/useTaxProfiles'
import { formatCents } from '../lib/money'
import { TaxProfileForm } from './TaxProfileForm'

interface TaxProfileListProps {
  members: Member[]
  profiles: TaxProfile[]
  onUpsert: (input: TaxProfileInput) => Promise<void>
}

/** One member's tax profile as a compact read-only row: residency, cover, and HELP debt. */
function TaxProfileCard({
  member,
  profile,
  onEdit,
}: {
  member: Member
  profile?: TaxProfile
  onEdit: () => void
}) {
  const foreign = profile?.residency === 'foreign_resident'
  return (
    <Card withBorder radius="md" p="xs">
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
              <Badge size="xs" color="teal">
                Hospital cover
              </Badge>
            )}
            {profile && profile.help_debt_cents > 0 && (
              <Text size="xs" c="dimmed">
                HELP {formatCents(profile.help_debt_cents)}
              </Text>
            )}
          </Group>
        </Stack>
        <ActionIcon variant="subtle" aria-label="Edit" onClick={onEdit} style={{ flexShrink: 0 }}>
          <IconPencil size={16} />
        </ActionIcon>
      </Group>
    </Card>
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
            onSubmit={async (input) => {
              await onUpsert(input)
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
