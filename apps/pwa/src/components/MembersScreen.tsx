import { Stack, Title } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TaxProfile, TaxProfileSubmission } from '../hooks/useTaxProfiles'
import { PageSection } from './PageSection'
import { TaxProfileList } from './TaxProfileList'

interface MembersScreenProps {
  members: Member[]
  taxProfiles: TaxProfile[]
  financialYear: number
  onUpsertTaxProfile: (submission: TaxProfileSubmission) => Promise<void>
}

/** Presentational per-member tax profiles: name, date of birth, and tax settings. */
export function MembersScreen({
  members,
  taxProfiles,
  financialYear,
  onUpsertTaxProfile,
}: MembersScreenProps) {
  return (
    <PageSection title="Members & tax profiles">
      <Stack gap="sm">
        <Title order={3} size="h5">
          Tax profiles (FY{financialYear})
        </Title>
        <TaxProfileList members={members} profiles={taxProfiles} onUpsert={onUpsertTaxProfile} />
      </Stack>
    </PageSection>
  )
}
