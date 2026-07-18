import { Stack, Title } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { Inflow, InflowInput } from '../hooks/useInflows'
import type { TaxProfile, TaxProfileInput } from '../hooks/useTaxProfiles'
import { InflowList } from './InflowList'
import { TaxProfileForm } from './TaxProfileForm'

interface InflowScreenProps {
  members: Member[]
  inflows: Inflow[]
  taxProfiles: TaxProfile[]
  financialYear: number
  onCreateInflow: (input: InflowInput) => Promise<void>
  onUpdateInflow: (id: string, input: InflowInput) => Promise<void>
  onDeleteInflow: (id: string) => Promise<void>
  onUpsertTaxProfile: (input: TaxProfileInput) => Promise<void>
}

/** Presentational inflow + tax-profile management. Persistence lives in the caller. */
export function InflowScreen({
  members,
  inflows,
  taxProfiles,
  financialYear,
  onCreateInflow,
  onUpdateInflow,
  onDeleteInflow,
  onUpsertTaxProfile,
}: InflowScreenProps) {
  return (
    <Stack gap="xl">
      <Stack gap="md">
        <Title order={2}>Inflows</Title>
        <InflowList
          inflows={inflows}
          members={members}
          onCreate={onCreateInflow}
          onUpdate={onUpdateInflow}
          onDelete={(id) => void onDeleteInflow(id)}
        />
      </Stack>

      <Stack gap="md">
        <Title order={2}>Tax profiles (FY{financialYear})</Title>
        {members.map((member) => (
          <TaxProfileForm
            key={member.id}
            member={member}
            initial={taxProfiles.find((profile) => profile.member_id === member.id)}
            onSubmit={onUpsertTaxProfile}
          />
        ))}
      </Stack>
    </Stack>
  )
}
